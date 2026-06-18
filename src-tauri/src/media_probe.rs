use crate::media_format::{
    format_bitrate, format_bytes, parse_frame_rate, pretty_codec, pretty_container,
};
use crate::process_tools::{ffprobe_binary, quiet_command};
use serde::{Deserialize, Serialize};

// ── ffprobe metadata ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProbeData {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: String,
    pub bit_rate: String,
    pub duration_secs: f64,
    pub timecode: String,
    pub container: String,
    pub audio_codec: String,
    pub audio_channels: u32,
    pub file_size: String,
    pub color_space: String,
}

#[tauri::command]
pub(crate) fn get_probe_data(app: tauri::AppHandle, path: String) -> Result<ProbeData, String> {
    let ffprobe = ffprobe_binary(&app);
    let output = quiet_command(&ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe error: {stderr}"));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {e}"))?;

    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let format = &json["format"];

    // Find first video stream
    let video = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"));
    // Find first audio stream
    let audio = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("audio"));

    let codec = video
        .and_then(|v| v["codec_name"].as_str())
        .map(pretty_codec)
        .unwrap_or_else(|| "—".to_string());

    let width = video.and_then(|v| v["width"].as_u64()).unwrap_or(0) as u32;
    let height = video.and_then(|v| v["height"].as_u64()).unwrap_or(0) as u32;

    let frame_rate = video
        .and_then(|v| v["r_frame_rate"].as_str())
        .map(parse_frame_rate)
        .unwrap_or_else(|| "—".to_string());

    // Prefer stream bit_rate, fall back to format bit_rate
    let bps = video
        .and_then(|v| v["bit_rate"].as_str().and_then(|s| s.parse::<u64>().ok()))
        .or_else(|| {
            format["bit_rate"]
                .as_str()
                .and_then(|s| s.parse::<u64>().ok())
        })
        .unwrap_or(0);
    let bit_rate = if bps > 0 {
        format_bitrate(bps)
    } else {
        "—".to_string()
    };

    let duration_secs = format["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    // Timecode: check stream tags → format tags → derive from duration
    let timecode = video
        .and_then(|v| v["tags"]["timecode"].as_str())
        .or_else(|| format["tags"]["timecode"].as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let h = (duration_secs / 3600.0) as u32;
            let m = ((duration_secs % 3600.0) / 60.0) as u32;
            let s = (duration_secs % 60.0) as u32;
            format!("{h:02}:{m:02}:{s:02}:00")
        });

    let container = format["format_name"]
        .as_str()
        .map(pretty_container)
        .unwrap_or_else(|| "—".to_string());

    let audio_codec = audio
        .and_then(|a| a["codec_name"].as_str())
        .map(pretty_codec)
        .unwrap_or_else(|| "—".to_string());

    let audio_channels = audio.and_then(|a| a["channels"].as_u64()).unwrap_or(0) as u32;

    let file_size = std::fs::metadata(&path)
        .map(|m| format_bytes(m.len()))
        .unwrap_or_else(|_| "—".to_string());

    let color_space = video
        .and_then(|v| v["color_space"].as_str())
        .unwrap_or("—")
        .to_string();

    Ok(ProbeData {
        codec,
        width,
        height,
        frame_rate,
        bit_rate,
        duration_secs,
        timecode,
        container,
        audio_codec,
        audio_channels,
        file_size,
        color_space,
    })
}
