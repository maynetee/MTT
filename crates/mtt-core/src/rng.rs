//! Deterministic PRNG (PCG32, XSH-RR 64/32). No OS entropy: the host passes a seed.

const MULTIPLIER: u64 = 6_364_136_223_846_793_005;
const DEFAULT_STREAM: u64 = 0xda3e_39cb_94b9_5bdb;

/// PCG32 generator. Output is frozen by golden tests; changing it breaks replays of
/// decisions made with a given seed (events themselves store the outcomes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rng {
    state: u64,
    inc: u64,
}

impl Rng {
    /// Reference PCG32 seeding (`pcg32_srandom_r`).
    pub fn new(init_state: u64, init_seq: u64) -> Self {
        let mut rng = Self {
            state: 0,
            inc: (init_seq << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(init_state);
        rng.next_u32();
        rng
    }

    /// Generator for a host-supplied seed.
    pub fn from_seed(seed: u64) -> Self {
        Self::new(seed, DEFAULT_STREAM)
    }

    /// Next 32 random bits.
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(MULTIPLIER).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform integer in `[0, bound)`, without modulo bias. Returns 0 when `bound == 0`.
    pub fn below(&mut self, bound: u32) -> u32 {
        if bound == 0 {
            return 0;
        }
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let r = self.next_u32();
            if r >= threshold {
                return r % bound;
            }
        }
    }

    /// Uniform index in `[0, len)`.
    pub fn index(&mut self, len: usize) -> usize {
        self.below(u32::try_from(len).unwrap_or(u32::MAX)) as usize
    }

    /// Uniformly chosen element, `None` when empty.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> Option<&'a T> {
        if items.is_empty() {
            None
        } else {
            items.get(self.index(items.len()))
        }
    }

    /// Fisher-Yates shuffle.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.index(i + 1);
            items.swap(i, j);
        }
    }
}

/// SplitMix64 finalizer, handy to derive independent seeds from one base seed.
pub fn mix_seed(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_pcg32_reference_output() {
        // pcg32-demo: pcg32_srandom_r(&rng, 42, 54).
        let mut rng = Rng::new(42, 54);
        let out: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();
        assert_eq!(
            out,
            [
                0xa15c_02b7,
                0x7b47_f409,
                0xba1d_3330,
                0x83d2_f293,
                0xbfa4_784b,
                0xcbed_606e
            ]
        );
    }

    #[test]
    fn golden_shuffle_and_bounded_output() {
        let mut rng = Rng::from_seed(7);
        let mut deck: Vec<u8> = (1..=10).collect();
        rng.shuffle(&mut deck);
        let bounded: Vec<u32> = (0..8).map(|_| rng.below(9)).collect();
        assert_eq!(deck, GOLDEN_DECK);
        assert_eq!(bounded, GOLDEN_BOUNDED);
        assert_eq!(mix_seed(0), 0xe220_a839_7b1d_cdaf);
    }

    const GOLDEN_DECK: [u8; 10] = [5, 10, 3, 9, 6, 7, 8, 1, 2, 4];
    const GOLDEN_BOUNDED: [u32; 8] = [3, 6, 3, 4, 2, 7, 3, 3];

    #[test]
    fn below_stays_in_bounds_and_is_deterministic() {
        let mut a = Rng::from_seed(123);
        let mut b = Rng::from_seed(123);
        for bound in 1..50 {
            let x = a.below(bound);
            assert!(x < bound);
            assert_eq!(x, b.below(bound));
        }
        assert_eq!(a.below(0), 0);
        assert_eq!(a.pick::<u8>(&[]), None);
    }
}
