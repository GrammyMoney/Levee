pub(crate) fn format_bitrate(bps: u64) -> String {
    if bps >= 1_000_000 {
        format!("{:.1} Mbps", bps as f64 / 1_000_000.0)
    } else if bps >= 1_000 {
        format!("{:.0} Kbps", bps as f64 / 1_000.0)
    } else {
        format!("{bps} bps")
    }
}

pub(crate) fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1_024 {
        format!("{:.1} KB", bytes as f64 / 1_024.0)
    } else {
        format!("{bytes} B")
    }
}

pub(crate) fn parse_frame_rate(s: &str) -> String {
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 2 {
        if let (Ok(num), Ok(den)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
            if den > 0.0 {
                let fps = num / den;
                // Common fractional frame rates
                let rounded = (fps * 1000.0).round() / 1000.0;
                return format!("{rounded:.3}")
                    .trim_end_matches('0')
                    .trim_end_matches('.')
                    .to_string()
                    + " fps";
            }
        }
    }
    s.to_string()
}

pub(crate) fn pretty_codec(raw: &str) -> String {
    match raw.to_lowercase().as_str() {
        "h264" | "libx264" => "H.264".to_string(),
        "h265" | "hevc" | "libx265" => "H.265 (HEVC)".to_string(),
        "prores" => "Apple ProRes".to_string(),
        "dnxhd" => "Avid DNxHD".to_string(),
        "vp9" => "VP9".to_string(),
        "av1" => "AV1".to_string(),
        "mpeg2video" => "MPEG-2".to_string(),
        "mjpeg" => "MJPEG".to_string(),
        "aac" => "AAC".to_string(),
        "mp3" => "MP3".to_string(),
        "pcm_s16le" | "pcm_s24le" | "pcm_s32le" => "PCM".to_string(),
        other => other.to_uppercase(),
    }
}

pub(crate) fn pretty_container(fmt_name: &str) -> String {
    let first = fmt_name.split(',').next().unwrap_or(fmt_name);
    match first {
        "mov" => "MOV".to_string(),
        "mp4" => "MP4".to_string(),
        "matroska" => "MKV".to_string(),
        "avi" => "AVI".to_string(),
        "mxf" => "MXF".to_string(),
        "webm" => "WebM".to_string(),
        other => other.to_uppercase(),
    }
}
