//! 解析 otpauth:// URI(QR Code 中常見的格式)
//! 範例:otpauth://totp/Issuer:Account?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30

use crate::totp::Algorithm;
use percent_encoding::percent_decode_str;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OtpType {
    Totp,
    Hotp,
}

#[derive(Debug, Clone)]
pub struct ParsedOtpAuth {
    pub otp_type: OtpType,
    pub label_issuer: Option<String>,
    pub account_name: String,
    pub secret: String,
    pub issuer: Option<String>,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
    /// 由 parser 解析並驗證(HOTP 必填),預留給未來 HOTP 支援使用。
    #[allow(dead_code)]
    pub counter: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("URI 格式錯誤: {0}")]
    InvalidUri(String),
    #[error("scheme 必須為 otpauth")]
    WrongScheme,
    #[error("type 必須為 totp 或 hotp")]
    InvalidType,
    #[error("缺少必要參數: {0}")]
    MissingParam(&'static str),
    #[error("參數值錯誤: {0}")]
    InvalidParam(&'static str),
}

pub fn parse(uri: &str) -> Result<ParsedOtpAuth, ParseError> {
    let url = Url::parse(uri).map_err(|e| ParseError::InvalidUri(e.to_string()))?;

    if url.scheme() != "otpauth" {
        return Err(ParseError::WrongScheme);
    }

    let otp_type = match url.host_str().unwrap_or("") {
        "totp" => OtpType::Totp,
        "hotp" => OtpType::Hotp,
        _ => return Err(ParseError::InvalidType),
    };

    // path 形如 "/Issuer:Account" 或 "/Account"
    let path = url.path().trim_start_matches('/');
    let decoded_path = percent_decode_str(path)
        .decode_utf8_lossy()
        .into_owned();
    let (label_issuer, account_name) = match decoded_path.split_once(':') {
        Some((iss, acc)) => (
            Some(iss.trim().to_string()),
            acc.trim().to_string(),
        ),
        None => (None, decoded_path.trim().to_string()),
    };

    let mut secret: Option<String> = None;
    let mut issuer: Option<String> = None;
    let mut algorithm = Algorithm::Sha1;
    let mut digits: u32 = 6;
    let mut period: u64 = 30;
    let mut counter: Option<u64> = None;

    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "secret" => secret = Some(v.into_owned()),
            "issuer" => issuer = Some(v.into_owned()),
            "algorithm" => {
                algorithm =
                    Algorithm::parse(&v).ok_or(ParseError::InvalidParam("algorithm"))?;
            }
            "digits" => {
                digits = v.parse().map_err(|_| ParseError::InvalidParam("digits"))?;
            }
            "period" => {
                period = v.parse().map_err(|_| ParseError::InvalidParam("period"))?;
            }
            "counter" => {
                counter = Some(v.parse().map_err(|_| ParseError::InvalidParam("counter"))?);
            }
            _ => {}
        }
    }

    let secret = secret.ok_or(ParseError::MissingParam("secret"))?;
    if account_name.is_empty() {
        return Err(ParseError::MissingParam("account name"));
    }
    if otp_type == OtpType::Hotp && counter.is_none() {
        return Err(ParseError::MissingParam("counter"));
    }

    Ok(ParsedOtpAuth {
        otp_type,
        label_issuer,
        account_name,
        secret,
        issuer,
        algorithm,
        digits,
        period,
        counter,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_totp() {
        let uri = "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
        let p = parse(uri).unwrap();
        assert_eq!(p.otp_type, OtpType::Totp);
        assert_eq!(p.label_issuer.as_deref(), Some("GitHub"));
        assert_eq!(p.account_name, "user@example.com");
        assert_eq!(p.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(p.issuer.as_deref(), Some("GitHub"));
        assert!(matches!(p.algorithm, Algorithm::Sha1));
        assert_eq!(p.digits, 6);
        assert_eq!(p.period, 30);
    }

    #[test]
    fn parse_with_all_params() {
        let uri = "otpauth://totp/Acme%20Co:alice%40example.com?secret=ABCD&issuer=Acme%20Co&algorithm=SHA256&digits=8&period=60";
        let p = parse(uri).unwrap();
        assert_eq!(p.label_issuer.as_deref(), Some("Acme Co"));
        assert_eq!(p.account_name, "alice@example.com");
        assert!(matches!(p.algorithm, Algorithm::Sha256));
        assert_eq!(p.digits, 8);
        assert_eq!(p.period, 60);
    }

    #[test]
    fn parse_hotp_requires_counter() {
        let no_counter = "otpauth://hotp/X?secret=AB";
        assert!(matches!(
            parse(no_counter),
            Err(ParseError::MissingParam("counter"))
        ));
        let ok = "otpauth://hotp/X?secret=AB&counter=42";
        let p = parse(ok).unwrap();
        assert_eq!(p.otp_type, OtpType::Hotp);
        assert_eq!(p.counter, Some(42));
    }

    #[test]
    fn parse_rejects_wrong_scheme() {
        assert!(matches!(
            parse("https://example.com"),
            Err(ParseError::WrongScheme)
        ));
    }

    #[test]
    fn parse_rejects_missing_secret() {
        assert!(matches!(
            parse("otpauth://totp/Account"),
            Err(ParseError::MissingParam("secret"))
        ));
    }
}
