import { DOC_LINKS } from "./config.js";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  fix?: string;
  docs?: string;
}

export interface PartyCheck {
  input: string;
  /** The ID after trimming surrounding whitespace. */
  party: string;
  valid: boolean;
  hint?: string;
  namespace?: string;
  issues: Issue[];
}

export interface PartyContext {
  /** The Gateway's own party, from /v1/chain. */
  gatewayParty?: string;
  /** Zenith's protocol namespace, from /v1/chain. */
  protocolNamespace?: string;
}

const NAMESPACE_RE = /^1220[0-9a-f]{64}$/;
const PROTOCOL_PREFIX_RE = /^(m|r|b)-/;
const HINT_CHARS_RE = /^[A-Za-z0-9_\-.:]+$/;

/**
 * Checks a Canton party ID before anything is sent to its Gateway inbox.
 * Every rule here comes from the "Before you send" checklist and the Common problems table in the Zenith docs.
 */
export function checkPartyId(input: string, ctx: PartyContext = {}): PartyCheck {
  const issues: Issue[] = [];
  const party = input.trim();
  if (party !== input) {
    issues.push({
      code: "SURROUNDING_WHITESPACE",
      severity: "warning",
      message: "The party ID had leading or trailing whitespace; it was trimmed.",
    });
  }
  if (!party) {
    return {
      input,
      party,
      valid: false,
      issues: [{ code: "EMPTY", severity: "error", message: "No party ID was given." }],
    };
  }
  if (/…|\.\.\./.test(party)) {
    issues.push({
      code: "DISPLAY_SHORTENED",
      severity: "error",
      message: "This looks like a shortened display form of a party ID (it contains an ellipsis).",
      fix: "Copy the full party ID (hint::1220…64 hex digits). Consoles shorten IDs when they display them; use toProtoPrimitive or the Ledger API.",
      docs: DOC_LINKS.beforeYouSend,
    });
  }
  const sep = party.lastIndexOf("::");
  if (sep < 0) {
    issues.push({
      code: "MISSING_NAMESPACE",
      severity: "error",
      message:
        "The party ID has no ::namespace part. A hint alone gives the inbox of an ID no party can have, and tokens sent there are lost.",
      fix: "Ask the recipient for their full party ID in the form hint::1220<64 hex>.",
      docs: DOC_LINKS.beforeYouSend,
    });
    return { input, party, valid: false, issues };
  }
  const hint = party.slice(0, sep);
  const namespace = party.slice(sep + 2);

  if (!hint)
    issues.push({ code: "EMPTY_HINT", severity: "error", message: "The part before :: is empty." });
  if (hint.includes("::")) {
    issues.push({
      code: "EXTRA_SEPARATOR",
      severity: "error",
      message: "The party ID contains :: more than once.",
    });
  }
  if (!NAMESPACE_RE.test(namespace)) {
    const lower = namespace.toLowerCase();
    issues.push({
      code: NAMESPACE_RE.test(lower) ? "NAMESPACE_CASE" : "BAD_NAMESPACE",
      severity: "error",
      message: NAMESPACE_RE.test(lower)
        ? "The namespace must be lower-case hex."
        : `The namespace "${namespace.slice(0, 16)}${namespace.length > 16 ? "…" : ""}" is not 1220 followed by 64 hex digits.`,
      fix: "Copy the full party ID again; do not retype it.",
      docs: DOC_LINKS.beforeYouSend,
    });
  }
  if (hint && !HINT_CHARS_RE.test(hint)) {
    issues.push({
      code: "UNUSUAL_HINT",
      severity: "warning",
      message: "The party hint contains characters Canton party hints do not normally use.",
    });
  }
  if (PROTOCOL_PREFIX_RE.test(hint)) {
    issues.push({
      code: "PROTOCOL_PARTY",
      severity: "error",
      message: `"${hint.slice(0, 2)}…" is a Zenith protocol party (mailbox, registrar or backing). Gateway never credits tokens sent to a protocol party's inbox; they are lost.`,
      fix: "Send to the recipient's own party ID. To move tokens to Zenith EVM, use a CIP-56 transfer to a mailbox party on Canton instead.",
      docs: DOC_LINKS.beforeYouSend,
    });
  }
  if (ctx.gatewayParty && party === ctx.gatewayParty) {
    issues.push({
      code: "GATEWAY_PARTY",
      severity: "error",
      message:
        "This is the Gateway's own party. Tokens sent to its inbox are never credited and are lost.",
      docs: DOC_LINKS.beforeYouSend,
    });
  } else if (
    ctx.protocolNamespace &&
    namespace === ctx.protocolNamespace &&
    !PROTOCOL_PREFIX_RE.test(hint)
  ) {
    issues.push({
      code: "PROTOCOL_NAMESPACE",
      severity: "warning",
      message:
        "This party lives in Zenith's protocol namespace. Make sure it is really the intended recipient.",
    });
  }

  const valid = !issues.some((i) => i.severity === "error");
  return { input, party, valid, hint, namespace, issues };
}
