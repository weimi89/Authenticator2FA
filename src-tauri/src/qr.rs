//! QR Code 圖片解碼:從圖片檔(PNG/JPEG/WebP/GIF/BMP)取出文字內容。
//!
//! 一張圖可能含多個 QR;這裡只回傳第一個成功解碼的內容。

use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum QrError {
    #[error("無法讀取圖片檔")]
    Read,
    #[error("圖片格式不支援")]
    Format,
    #[error("圖片中找不到 QR Code")]
    NotFound,
    #[error("QR Code 解碼失敗")]
    Decode,
}

pub fn decode_from_path(path: &Path) -> Result<String, QrError> {
    let bytes = std::fs::read(path).map_err(|_| QrError::Read)?;
    decode_from_bytes(&bytes)
}

pub fn decode_from_bytes(bytes: &[u8]) -> Result<String, QrError> {
    let img = image::load_from_memory(bytes).map_err(|_| QrError::Format)?;
    let gray = img.to_luma8();

    let mut prepared = rqrr::PreparedImage::prepare(gray);
    let grids = prepared.detect_grids();
    let grid = grids.into_iter().next().ok_or(QrError::NotFound)?;

    let (_meta, content) = grid.decode().map_err(|_| QrError::Decode)?;
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_invalid_bytes_fails() {
        assert!(matches!(
            decode_from_bytes(b"not an image"),
            Err(QrError::Format)
        ));
    }

    #[test]
    fn decode_blank_image_returns_not_found() {
        // 1x1 全白 PNG
        use image::{ImageBuffer, Rgb};
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_pixel(8, 8, Rgb([255, 255, 255]));
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png).unwrap();
        let result = decode_from_bytes(&buf.into_inner());
        assert!(matches!(result, Err(QrError::NotFound)));
    }
}
