#include "captain_kws_gate.h"
#include <algorithm>
#include <cstring>

CaptainKwsGate::CaptainKwsGate(float threshold, unsigned consecutive,
                               std::uint32_t cooldown_ms, SendAudio send_audio,
                               void* user)
    : threshold_(threshold), required_hits_(std::max(1u, consecutive)),
      cooldown_ms_(cooldown_ms), send_audio_(send_audio), user_(user) {}

void CaptainKwsGate::Store(const std::int16_t* pcm) {
  for (std::size_t i = 0; i < kFrameSamples; ++i) {
    ring_[ring_head_] = pcm[i];
    ring_head_ = (ring_head_ + 1) % kPreRollSamples;
    if (ring_head_ == 0) ring_full_ = true;
  }
}

bool CaptainKwsGate::FlushPreRoll() {
  if (!send_audio_) return false;
  if (!ring_full_) return send_audio_(ring_, ring_head_, user_);
  const std::size_t tail = kPreRollSamples - ring_head_;
  return send_audio_(ring_ + ring_head_, tail, user_) &&
         send_audio_(ring_, ring_head_, user_);
}

bool CaptainKwsGate::OnFrame(const std::int16_t* pcm, float probability,
                             std::uint32_t now_ms) {
  if (!pcm) return false;
  Store(pcm);
  if (streaming_) return send_audio_(pcm, kFrameSamples, user_);
  const bool cooling = ever_woke_ && static_cast<std::uint32_t>(now_ms - last_wake_ms_) < cooldown_ms_;
  hits_ = (!cooling && probability >= threshold_) ? hits_ + 1 : 0;
  if (hits_ < required_hits_) return false;
  hits_ = 0; ever_woke_ = true; last_wake_ms_ = now_ms;
  streaming_ = FlushPreRoll();
  return streaming_;
}

void CaptainKwsGate::StopStreaming() { streaming_ = false; hits_ = 0; }

static_assert(sizeof(CaptainKwsGate) < 10 * 1024, "wake gate RAM regression");
