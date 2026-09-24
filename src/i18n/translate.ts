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

/**
 * The same shape, for another language. Any message may take plural forms there, even one that
 * needs none in English (French writes places as ordinals: `1er`, `2e`).
 */
export type Translation<T> = {
  readonly [K in keyof T]: T[K] extends Message ? Message : Translation<T[K]>;
};

/** The `{name}` placeholders of a message, every plural form included. */
type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;
type MessagePlaceholders<M> = M extends string ? Placeholders<M> : M extends PluralMessage ? Placeholders<M[keyof M]> : never;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Dotted keys of `T` whose message in `U` has other placeholders (a missing or extra key fails
 * `Translation<T>` already). `never` when the translation matches.
 */
export type PlaceholderMismatches<T, U, Prefix extends string = ""> = {
  [K in keyof T & keyof U & string]: T[K] extends Message
    ? Same<MessagePlaceholders<T[K]>, MessagePlaceholders<U[K]>> extends true
      ? never
      : `${Prefix}${K}`
    : PlaceholderMismatches<T[K], U[K], `${Prefix}${K}.`>;
}[keyof T & keyof U & string];

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
