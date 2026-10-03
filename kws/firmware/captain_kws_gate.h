#pragma once
#include <cstddef>
#include <cstdint>

// Allocation-free wake gate and pre-roll buffer. Model inference and transport
// are injected so the same code can be used on ESP-IDF or another MCU runtime.
class CaptainKwsGate {
 public:
  static constexpr std::size_t kFrameSamples = 320;   // 20 ms at 16 kHz
  static constexpr std::size_t kPreRollSamples = 4800; // 300 ms

  using SendAudio = bool (*)(const std::int16_t*, std::size_t, void*);

  CaptainKwsGate(float threshold, unsigned consecutive, std::uint32_t cooldown_ms,
                 SendAudio send_audio, void* user);
  bool OnFrame(const std::int16_t* pcm, float keyword_probability, std::uint32_t now_ms);
  void StopStreaming();
  bool streaming() const { return streaming_; }

 private:
  void Store(const std::int16_t* pcm);
  bool FlushPreRoll();
  std::int16_t ring_[kPreRollSamples]{};
  std::size_t ring_head_ = 0;
  bool ring_full_ = false;
  float threshold_;
  unsigned required_hits_;
  unsigned hits_ = 0;
  std::uint32_t cooldown_ms_;
  std::uint32_t last_wake_ms_ = 0;
  bool ever_woke_ = false;
  bool streaming_ = false;
  SendAudio send_audio_;
  void* user_;
};
