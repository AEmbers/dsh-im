// Shared by the Host and settings UI; keep this module browser-compatible.
export const CONTEXT_ENHANCEMENT_FIELDS = Object.freeze([
  'channel', 'conversationType', 'senderId', 'senderName', 'conversationTitle',
  'chatId', 'threadId', 'botId', 'sentAt',
]);

/**
 * Tag grammar of the injected context prefix. The producer here and the
 * Host-side splitter in `injected-context.mjs` share these literals, so the
 * prefix a channel writes can never drift from the parser that pairs it.
 */
export const INJECTED_CONTEXT_TAGS = Object.freeze({
  sourceOpen: '<dsh_im_source>',
  sourceClose: '</dsh_im_source>',
  guidanceOpen: '<dsh_im_source_guidance>',
  guidanceClose: '</dsh_im_source_guidance>',
  replyOpen: '<dsh_im_reply_to>',
  replyClose: '</dsh_im_reply_to>',
});

/** Separator the producer joins prefix blocks with, and the splitter consumes. */
export const INJECTED_CONTEXT_SEPARATOR = '\n\n';

export const CONTEXT_ENHANCEMENT_GUIDANCE_MAX_LENGTH = 8_000;
export const CONTEXT_GROUP_GUIDANCE_EXAMPLE = `仅依据当前消息的 <dsh_im_source> 中实际提供的字段理解来源；没有提供的字段不要猜测或补全。
当前消息来自群聊，请使用严肃、克制、简洁的表达方式。`;
export const CONTEXT_DIRECT_GUIDANCE_EXAMPLE = `仅依据当前消息的 <dsh_im_source> 中实际提供的字段理解来源；没有提供的字段不要猜测或补全。
当前消息来自私聊，可以使用更轻松、幽默、详细的表达方式。`;

// Kept for integrations that imported the original combined example.
export const CONTEXT_GUIDANCE_EXAMPLE = `仅依据当前消息的 <dsh_im_source> 中实际提供的字段理解来源；没有提供的字段不要猜测或补全。
conversationType是群聊时回复严肃一点，conversationType是私聊时回复一定要幽默搞笑，像周星驰的电影一样搞笑`;

// Kept as an alias for integrations that imported the original template name.
export const DEFAULT_CONTEXT_GUIDANCE = CONTEXT_GUIDANCE_EXAMPLE;

export const DEFAULT_CONTEXT_ENHANCEMENT_CONFIG = Object.freeze({
  group: Object.freeze({
    enabled: false,
    fields: Object.freeze(['senderId']),
    guidance: '',
  }),
  direct: Object.freeze({
    enabled: false,
    fields: Object.freeze(['senderId']),
    guidance: '',
  }),
});

const CONFIG_KEYS = ['group', 'direct'];
const SCOPE_KEYS = ['enabled', 'fields', 'guidance'];
const LEGACY_CONFIG_KEYS = ['groupEnabled', 'directEnabled', 'fields', 'guidance'];
const CHANNELS = new Set([
  'wecom', 'weixin', 'feishu', 'dingtalk', 'qq',
  'slack', 'telegram', 'discord', 'whatsapp',
]);
const SOURCE_LIMITS = {
  channel: 16, conversationType: 6, senderId: 256, senderName: 256,
  conversationTitle: 256, chatId: 256, threadId: 256, botId: 128, sentAt: 32,
};
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

function invalidConfig(message) {
  const error = new TypeError(message);
  error.code = 'context-enhancement-invalid';
  return error;
}

function hasExactKeys(input, keys) {
  return input && typeof input === 'object' && !Array.isArray(input)
    && [Object.prototype, null].includes(Object.getPrototypeOf(input))
    && Reflect.ownKeys(input).length === keys.length
    && keys.every((key) => Object.hasOwn(input, key));
}

function validateContextEnhancementScope(input) {
  if (!hasExactKeys(input, SCOPE_KEYS)) {
    throw invalidConfig('请提交完整的上下文增强设置。');
  }
  const { enabled, fields, guidance } = input;
  if (typeof enabled !== 'boolean') {
    throw invalidConfig('群聊和私聊开关必须是布尔值。');
  }
  if (!Array.isArray(fields) || ![...fields].every((field) => CONTEXT_ENHANCEMENT_FIELDS.includes(field))) {
    throw invalidConfig('来源字段只能选择已定义的字段。');
  }
  if (typeof guidance !== 'string' || guidance.length > CONTEXT_ENHANCEMENT_GUIDANCE_MAX_LENGTH) {
    throw invalidConfig(`增强提示词不得超过 ${CONTEXT_ENHANCEMENT_GUIDANCE_MAX_LENGTH} 个字符。`);
  }
  return Object.freeze({
    enabled,
    fields: Object.freeze(CONTEXT_ENHANCEMENT_FIELDS.filter((field) => fields.includes(field))),
    guidance: guidance.trim() ? guidance : '',
  });
}

/** Validate the complete atomic save, preserving explicit empty selections/text. */
export function validateContextEnhancementConfig(input) {
  if (!hasExactKeys(input, CONFIG_KEYS)) {
    throw invalidConfig('请提交完整的上下文增强设置。');
  }
  return Object.freeze({
    group: validateContextEnhancementScope(input.group),
    direct: validateContextEnhancementScope(input.direct),
  });
}

function migrateLegacyContextEnhancementConfig(input) {
  if (!hasExactKeys(input, LEGACY_CONFIG_KEYS)) {
    throw invalidConfig('请提交完整的上下文增强设置。');
  }
  return validateContextEnhancementConfig({
    group: {
      enabled: input.groupEnabled,
      fields: input.fields,
      guidance: input.guidance,
    },
    direct: {
      enabled: input.directEnabled,
      fields: input.fields,
      guidance: input.guidance,
    },
  });
}

/** Missing or damaged enhancement settings must never break an existing bot. */
export function normalizeContextEnhancementConfig(input) {
  try {
    return validateContextEnhancementConfig(input);
  } catch {
    try {
      return migrateLegacyContextEnhancementConfig(input);
    } catch {
      return DEFAULT_CONTEXT_ENHANCEMENT_CONFIG;
    }
  }
}

/** Capture before queueing. The off path reads only the applicable switch. */
export function captureContextEnhancement(provider, conversationType) {
  if (conversationType !== 'group' && conversationType !== 'direct') return null;
  try {
    const settings = provider?.getSettings?.();
    const legacyEnabledKey = conversationType === 'group' ? 'groupEnabled' : 'directEnabled';
    const enabled = Object.hasOwn(settings ?? {}, conversationType)
      ? settings?.[conversationType]?.enabled
      : settings?.[legacyEnabledKey];
    if (enabled !== true) return null;
    const config = normalizeContextEnhancementConfig(settings);
    const scope = config[conversationType];
    if (scope.enabled !== true) return null;
    return Object.freeze({ config: scope, botId: provider.botId, conversationType });
  } catch {
    return null;
  }
}

/**
 * Property a channel hangs its captured moment on, using `withSentAt`.
 *
 * It sits on the source factory instead of being read out of it, because a
 * factory reads the inbound event's fields -- sometimes through throwing
 * getters -- and only a prompt that actually renders a source block may do
 * that. Local commands (`/help`, `/new`, `/steer`) take the enhancement to keep
 * its privacy rules but never read a source, and that must stay true.
 */
const SENT_AT = 'sentAt';

/** One-shot latch: a wiring bug is worth saying once, not once per message. */
let warnedMissingSentAt = false;

/**
 * Wrap one channel source factory so it also publishes the moment of the
 * message, without reading any of the message's fields yet.
 *
 * `value` may itself be a thunk: a channel that derives the moment from the
 * inbound event (a `create_time_ms` field, a message-id decode) should pass one,
 * because evaluating it here would read the inbound message even when the scope
 * is disabled or the `sentAt` field is not selected -- and a disabled scope must
 * read nothing at all.
 *
 * @param factory - the channel's source factory, or nothing.
 * @param value - platform send time (epoch ms or ISO-8601), a thunk returning
 *   one, or nothing to let the capture fall back to the dispatch clock.
 * @returns the same shape, plus `sentAt` when a usable value was supplied.
 */
export function withSentAt(factory, value) {
  const wrapped = typeof factory === 'function' ? (...args) => factory(...args) : () => factory;
  const published = typeof value === 'function' ? value : () => value;
  Object.defineProperty(wrapped, SENT_AT, { value: published, enumerable: false });
  return wrapped;
}

/**
 * Read the moment a channel published, without invoking its source factory.
 *
 * The stored accessor is a thunk, so an unusable published value simply yields
 * nothing here and the capture falls back to its own clock.
 *
 * @param source - a source factory carrying `sentAt`, or a plain source object.
 * @returns the captured epoch milliseconds, or undefined when none was given.
 */
function publishedSentAt(source) {
  const own = typeof source === 'function' || (source !== null && typeof source === 'object')
    ? source?.[SENT_AT]
    : undefined;
  const value = typeof own === 'function' ? own() : own;
  return timestampMs(value) ?? undefined;
}

/**
 * Capture the enhancement one prompt replays, together with the source factory
 * that fills its selected fields.
 *
 * Ordinary messages snapshot this when they are accepted, so a queued message
 * keeps the settings it arrived under. A control command is never queued, so it
 * captures at the moment it runs -- and it must, because the source fields of a
 * steering instruction belong to whoever issued it, not to the message that
 * opened the turn.
 *
 * @param provider - the bot's enhancement provider.
 * @param conversationType - the inbound message's scope.
 * @param source - factory for the currently selected source fields; attach the
 *   moment with `withSentAt` to publish a platform send time.
 * @returns the enhancement to apply, or null when the scope is off.
 */
export function captureContextEnhancementSource(provider, conversationType, source) {
  // No provider means enhancement is not configured for this channel at all, so
  // there is nothing to capture -- and the thunk a channel published must not be
  // evaluated. Answering null here is what lets every channel call this
  // unconditionally, including bots with no enhancement settings.
  if (typeof provider?.getSettings !== 'function') return null;
  const snapshot = captureContextEnhancement(provider, conversationType);
  if (snapshot === null) return null;
  // The clock is read where the prompt is dispatched, so a replay cannot drift
  // to a later moment; the message's own fields stay unread until a prompt
  // actually renders them.
  //
  // `sentAt` stays undefined unless the channel actually published a moment. A
  // channel that has not wired one must not answer a `sentAt` selection with the
  // local clock: the model cannot tell the two apart, and a silently substituted
  // time is worse than an omitted field. Wiring a channel means passing the
  // moment through `withSentAt`.
  const sentAt = source?.[SENT_AT] === undefined ? undefined : publishedSentAt(source);
  return Object.freeze({ snapshot, source, sentAt });
}

/** Accept a millisecond epoch or an ISO-8601 string; anything else yields null. */
function timestampMs(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'bigint') value = Number(value);
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Render one epoch instant as `YYYY-MM-DD HH:mm:ss` in local time. The zone is
 * deliberately omitted: four independent components already carry the digits,
 * and the guidance text is the place to name the timezone.
 *
 * Padding is spelled out per component instead of calling a module-level
 * helper: `sourceBlock` can run while this module is still initializing, and
 * reading a `const` declared below would throw a temporal-dead-zone error that
 * the caller's catch silently swallows -- dropping the entire prefix.
 */
function formatTimestamp(ms) {
  const date = new Date(ms);
  const year = date.getFullYear();
  if (!Number.isInteger(year)) return undefined;
  const pad = (value) => String(value).padStart(2, '0');
  return `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sourceString(value, field) {
  if (field === 'senderId' && (typeof value === 'bigint' || Number.isFinite(value))) {
    value = String(value);
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(CONTROL_CHARACTERS, '').trim().slice(0, SOURCE_LIMITS[field]);
  if (!normalized || (field === 'channel' && !CHANNELS.has(normalized))) return undefined;
  return normalized;
}

function sourceBlock(snapshot, sourceFactory, capturedSentAt) {
  const { fields } = snapshot.config;
  const needsSource = fields.some((field) => [
    'channel', 'senderId', 'senderName', 'conversationTitle', 'chatId', 'threadId', 'sentAt',
  ].includes(field));
  const source = needsSource ? sourceFactory?.() : null;
  const projected = {};
  for (const field of fields) {
    if (field === 'sentAt') {
      // Only a channel that actually published a moment through `withSentAt`
      // renders this field. The raw `sentAt` a factory returns is never read:
      // the capture already validated it, so re-reading could let "", NaN or a
      // non-date string through, or let a good capture be overridden by none.
      // A caller holding only a scope snapshot may still pre-render the string.
      const published = typeof sourceFactory?.[SENT_AT] !== 'undefined';
      const rendered = !published && capturedSentAt === undefined ? source?.[field] : undefined;
      const raw = typeof rendered === 'string'
        ? rendered
        : (published ? (publishedSentAt(sourceFactory) ?? capturedSentAt) : capturedSentAt);
      const formatted = typeof raw === 'string'
        ? raw
        : (typeof raw === 'number' ? formatTimestamp(raw) : undefined);
      if (typeof formatted === 'string' && formatted.trim()) {
        projected[field] = formatted.replace(CONTROL_CHARACTERS, '').trim().slice(0, SOURCE_LIMITS[field]);
      } else if (published) {
        // The channel did publish a moment but it was unusable: that is worth
        // saying once, because the omitted field is otherwise indistinguishable
        // from a channel that supplies none.
        if (!warnedMissingSentAt) {
          warnedMissingSentAt = true;
          console.warn('[dsh-im] a published sentAt was unusable and was omitted from the block');
        }
      }
      continue;
    }
    const value = field === 'botId' || field === 'conversationType'
      ? snapshot[field] : source?.[field];
    const normalized = sourceString(value, field);
    if (normalized !== undefined) projected[field] = normalized;
  }
  if (Object.keys(projected).length === 0) return '';
  const json = JSON.stringify(projected).replace(/[<>&]/g, (character) => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026',
  })[character]);
  return `${INJECTED_CONTEXT_TAGS.sourceOpen}${json}${INJECTED_CONTEXT_TAGS.sourceClose}`;
}

function guidanceBlock(guidance) {
  if (!guidance.trim()) return '';
  const body = guidance.replace(/<\/?dsh_im_source_guidance\b[^>]*(?:>|$)/gi, (tag) => (
    tag.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  ));
  return `${INJECTED_CONTEXT_TAGS.guidanceOpen}\n${body}\n${INJECTED_CONTEXT_TAGS.guidanceClose}`;
}

/**
 * Add one text prefix; never inspect sources, format or copy content when off.
 *
 * @param content - the message body the channel is about to send.
 * @param snapshot - either a capture from `captureContextEnhancementSource`
 *   (which already carries the moment and its own source) or a bare scope
 *   snapshot from `captureContextEnhancement`.
 * @param sourceFactory - the channel's source factory, when the caller holds it
 *   separately from the capture. Omit it for a capture: the capture's own
 *   factory and moment are used, so a `sentAt` selection cannot be lost by
 *   passing only its `.snapshot`.
 */
export function enhanceContextContent(content, snapshot, sourceFactory) {
  if (!snapshot) return content;
  // A capture is `{snapshot, source, sentAt}`; a bare scope is `{config, ...}`.
  const scope = snapshot.config ? snapshot : snapshot.snapshot;
  if (!scope?.config) return content;
  const factory = sourceFactory ?? (snapshot.config ? undefined : snapshot.source);
  try {
    const blocks = [sourceBlock(scope, factory, snapshot.sentAt), guidanceBlock(scope.config.guidance)]
      .filter(Boolean);
    if (blocks.length === 0) return content;
    const prefix = blocks.join(INJECTED_CONTEXT_SEPARATOR);
    if (typeof content === 'string') return `${prefix}\n\n${content}`;
    if (Array.isArray(content)) return [{ type: 'text', text: prefix }, ...content];
    return content;
  } catch {
    // Only enhancement errors are isolated; the caller's original flow proceeds.
    return content;
  }
}
