/** A message with plural forms, chosen by the `count` parameter. */
export interface PluralMessage {
  readonly zero?: string;
  readonly one: string;
  readonly other: string;
}

export type Message = string | PluralMessage;

export interface MessageTree {
  readonly [key: string]: Message | MessageTree;
}

/** Dotted paths of every message in a dictionary, e.g. `"errors.NAME_TAKEN"`. */
export type MessageKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Message ? `${Prefix}${K}` : MessageKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** The same shape with plain strings, for other languages. */
export type Translation<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : T[K] extends PluralMessage ? PluralMessage : Translation<T[K]>;
};

export type Params = Readonly<Record<string, string | number | null | undefined>>;

function isPlural(message: Message | MessageTree): message is PluralMessage {
  return typeof message === "object" && typeof message.one === "string" && typeof message.other === "string";
}

export function lookup(tree: MessageTree, key: string): Message | undefined {
  let node: Message | MessageTree | undefined = tree;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string" || isPlural(node)) return undefined;
    node = node[part];
  }
  return node !== undefined && (typeof node === "string" || isPlural(node)) ? node : undefined;
}

/**
 * Builds `t(key, params)`: looks the key up, picks the plural form from `params.count`
 * (`zero` when given and the count is 0), then replaces `{name}` placeholders. Numbers are
 * formatted for the locale; a missing key returns the key itself so it shows up in the UI.
 */
export function createTranslate(tree: MessageTree, locale: string) {
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  return (key: string, params: Params = {}): string => {
    const message = lookup(tree, key);
    if (message === undefined) return key;
    let text: string;
    if (typeof message === "string") {
      text = message;
    } else {
      const count = Number(params.count ?? 0);
      text = count === 0 && message.zero !== undefined ? message.zero : plurals.select(count) === "one" ? message.one : message.other;
    }
    return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params[name];
      if (value === undefined || value === null) return placeholder;
      return typeof value === "number" ? numbers.format(value) : value;
    });
  };
}
