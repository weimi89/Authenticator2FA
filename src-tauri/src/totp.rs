//! RFC 4226 (HOTP) / RFC 6238 (TOTP) 實作

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Algorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl Default for Algorithm {
    fn default() -> Self {
        Algorithm::Sha1
    }
}

impl Algorithm {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_uppercase().as_str() {
            "SHA1" => Some(Algorithm::Sha1),
            "SHA256" => Some(Algorithm::Sha256),
            "SHA512" => Some(Algorithm::Sha512),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TotpError {
    #[error("HMAC 金鑰長度錯誤")]
    InvalidKeyLength,
    #[error("digits 必須介於 6-10 之間")]
    InvalidDigits,
}

/// 計算 HOTP 程式碼。
/// `key` 為原始位元組(已從 base32 解碼);`counter` 為計數器(TOTP 為 time / period)。
pub fn hotp(algorithm: Algorithm, key: &[u8], counter: u64, digits: u32) -> Result<u32, TotpError> {
    if !(6..=10).contains(&digits) {
        return Err(TotpError::InvalidDigits);
    }
    if key.is_empty() {
        return Err(TotpError::InvalidKeyLength);
    }

    let counter_bytes = counter.to_be_bytes();
    let mac = match algorithm {
        Algorithm::Sha1 => {
            let mut m = <Hmac<Sha1>>::new_from_slice(key).map_err(|_| TotpError::InvalidKeyLength)?;
            m.update(&counter_bytes);
            m.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha256 => {
            let mut m =
                <Hmac<Sha256>>::new_from_slice(key).map_err(|_| TotpError::InvalidKeyLength)?;
            m.update(&counter_bytes);
            m.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha512 => {
            let mut m =
                <Hmac<Sha512>>::new_from_slice(key).map_err(|_| TotpError::InvalidKeyLength)?;
            m.update(&counter_bytes);
            m.finalize().into_bytes().to_vec()
        }
    };

    // 動態截斷 (RFC 4226 §5.3)
    let offset = (mac[mac.len() - 1] & 0x0F) as usize;
    let bin_code = ((mac[offset] & 0x7F) as u32) << 24
        | (mac[offset + 1] as u32) << 16
        | (mac[offset + 2] as u32) << 8
        | (mac[offset + 3] as u32);

    let modulus = 10u32.pow(digits);
    Ok(bin_code % modulus)
}

/// 計算 TOTP 程式碼,回傳 (code, 還剩幾秒, 此週期 counter)。
pub fn totp(
    algorithm: Algorithm,
    key: &[u8],
    unix_time: u64,
    period: u64,
    digits: u32,
) -> Result<TotpResult, TotpError> {
    if period == 0 {
        return Err(TotpError::InvalidDigits);
    }
    let counter = unix_time / period;
    let elapsed = unix_time % period;
    let remaining = period - elapsed;
    let code = hotp(algorithm, key, counter, digits)?;
    Ok(TotpResult {
        code,
        digits,
        counter,
        period,
        remaining,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct TotpResult {
    pub code: u32,
    pub digits: u32,
    pub counter: u64,
    pub period: u64,
    pub remaining: u64,
}

impl TotpResult {
    pub fn formatted(&self) -> String {
        format!("{:0width$}", self.code, width = self.digits as usize)
    }
}

/// base32 解碼 TOTP secret(忽略空白與大小寫)。
pub fn decode_secret(secret: &str) -> Option<Vec<u8>> {
    let cleaned: String = secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    base32::decode(base32::Alphabet::Rfc4648 { padding: false }, &cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 附錄 B 測試向量 — 共用密鑰 "12345678901234567890" (ASCII)
    /// 參考: https://datatracker.ietf.org/doc/html/rfc6238#appendix-B
    #[test]
    fn rfc6238_sha1_vectors() {
        let key = b"12345678901234567890";
        let cases: &[(u64, u32)] = &[
            (59, 94287082),
            (1111111109, 7081804),
            (1111111111, 14050471),
            (1234567890, 89005924),
            (2000000000, 69279037),
            (20000000000, 65353130),
        ];
        for (t, expected) in cases {
            let r = totp(Algorithm::Sha1, key, *t, 30, 8).unwrap();
            assert_eq!(r.code, *expected, "T={}", t);
        }
    }

    #[test]
    fn rfc6238_sha256_vectors() {
        let key = b"12345678901234567890123456789012";
        let cases: &[(u64, u32)] = &[
            (59, 46119246),
            (1111111109, 68084774),
            (1111111111, 67062674),
            (1234567890, 91819424),
            (2000000000, 90698825),
        ];
        for (t, expected) in cases {
            let r = totp(Algorithm::Sha256, key, *t, 30, 8).unwrap();
            assert_eq!(r.code, *expected, "T={}", t);
        }
    }

    #[test]
    fn rfc6238_sha512_vectors() {
        let key = b"1234567890123456789012345678901234567890123456789012345678901234";
        let cases: &[(u64, u32)] = &[
            (59, 90693936),
            (1111111109, 25091201),
            (1111111111, 99943326),
            (1234567890, 93441116),
        ];
        for (t, expected) in cases {
            let r = totp(Algorithm::Sha512, key, *t, 30, 8).unwrap();
            assert_eq!(r.code, *expected, "T={}", t);
        }
    }

    #[test]
    fn rfc4226_hotp_vectors() {
        // RFC 4226 附錄 D
        let key = b"12345678901234567890";
        let expected: &[u32] = &[
            755224, 287082, 359152, 969429, 338314, 254676, 287922, 162583, 399871, 520489,
        ];
        for (i, exp) in expected.iter().enumerate() {
            let code = hotp(Algorithm::Sha1, key, i as u64, 6).unwrap();
            assert_eq!(code, *exp);
        }
    }

    #[test]
    fn formatted_pads_zeros() {
        let r = TotpResult {
            code: 42,
            digits: 6,
            counter: 0,
            period: 30,
            remaining: 30,
        };
        assert_eq!(r.formatted(), "000042");
    }

    #[test]
    fn decode_secret_handles_spaces_and_case() {
        let a = decode_secret("JBSWY3DPEHPK3PXP").unwrap();
        let b = decode_secret("jbsw y3dp ehpk 3pxp").unwrap();
        let c = decode_secret("JBSW-Y3DP-EHPK-3PXP").unwrap();
        assert_eq!(a, b);
        assert_eq!(a, c);
    }
}
