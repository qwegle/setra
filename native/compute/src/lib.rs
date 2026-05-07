use napi_derive::napi;
use rayon::prelude::*;

/// Compute cosine similarity between two vectors.
/// Used for semantic memory matching.
#[napi]
pub fn cosine_similarity(a: Vec<f64>, b: Vec<f64>) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();

    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

/// Batch cosine similarity: compare one query vector against many candidates.
/// Returns similarity scores in the same order as candidates.
/// Uses Rayon for parallel computation across CPU cores.
#[napi]
pub fn batch_cosine_similarity(query: Vec<f64>, candidates: Vec<Vec<f64>>) -> Vec<f64> {
    candidates
        .par_iter()
        .map(|candidate| {
            let dot: f64 = query.iter().zip(candidate.iter()).map(|(a, b)| a * b).sum();
            let mag_q: f64 = query.iter().map(|x| x * x).sum::<f64>().sqrt();
            let mag_c: f64 = candidate.iter().map(|x| x * x).sum::<f64>().sqrt();
            if mag_q == 0.0 || mag_c == 0.0 {
                0.0
            } else {
                dot / (mag_q * mag_c)
            }
        })
        .collect()
}

/// Fast content hash using FNV-1a. Returns a hex string.
/// Much faster than SHA-256 for cache key generation.
#[napi]
pub fn fast_hash(content: String) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in content.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

/// Count approximate tokens in text (whitespace + punctuation split).
/// Faster than tiktoken for rough estimates.
#[napi]
pub fn count_tokens_approx(text: String) -> u32 {
    if text.is_empty() {
        return 0;
    }
    // Approximate: ~4 chars per token on average for English
    let char_count = text.len() as f64;
    (char_count / 4.0).ceil() as u32
}

/// Parse a unified diff and return file paths that were modified.
#[napi]
pub fn parse_diff_files(diff: String) -> Vec<String> {
    let mut files = Vec::new();
    for line in diff.lines() {
        if let Some(path) = line.strip_prefix("+++ b/") {
            if path != "/dev/null" {
                files.push(path.to_string());
            }
        }
    }
    files
}

/// Count additions and deletions in a unified diff.
#[napi]
pub fn diff_stats(diff: String) -> DiffStats {
    let mut additions = 0u32;
    let mut deletions = 0u32;

    for line in diff.lines() {
        if line.starts_with('+') && !line.starts_with("+++") {
            additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            deletions += 1;
        }
    }

    DiffStats {
        additions,
        deletions,
    }
}

#[napi(object)]
pub struct DiffStats {
    pub additions: u32,
    pub deletions: u32,
}
