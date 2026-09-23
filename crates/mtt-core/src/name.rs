//! Player name cleaning and uniqueness keys.

use unicode_normalization::UnicodeNormalization;

/// Maximum length of a player name, in characters.
pub const MAX_NAME_CHARS: usize = 64;

/// Display form: trimmed, inner whitespace collapsed to one space, NFC.
pub fn clean(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .nfc()
        .collect()
}

/// Uniqueness key: the cleaned name, lowercased and re-normalized to NFC.
pub fn key(raw: &str) -> String {
    clean(raw).to_lowercase().nfc().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_trims_and_collapses_whitespace() {
        assert_eq!(clean("  Jean \t  Dupont \n"), "Jean Dupont");
        assert_eq!(clean("   "), "");
    }

    #[test]
    fn key_ignores_case_whitespace_and_normalization() {
        let composed = "Ren\u{e9}";
        let decomposed = "rene\u{301}";
        assert_eq!(key(composed), key(decomposed));
        assert_eq!(key(" JEAN   dupont"), key("jean dupont"));
        assert_ne!(key("Jean"), key("Jeanne"));
    }
}
