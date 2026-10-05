# Anti-spoofing weights

MiniFASNetV2 (crop 2.7×) and MiniFASNetV1SE (crop 4.0×), 80×80 input, from
[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing)
(Apache-2.0), converted from PyTorch to ONNX (opset 13). The converted models
match the originals to within 1e-6 on random inputs.

| File | Source | SHA-256 |
|---|---|---|
| minifasnet_v2_2.7.onnx | 2.7_80x80_MiniFASNetV2.pth (a5eb02e1…) | 602be1888e24ad060d18eec7226fa7065b489b5b970d549c3a947cc10314563a |
| minifasnet_v1se_4.0.onnx | 4_0_0_80x80_MiniFASNetV1SE.pth (84ee1d37…) | a5d4e5fe8d5ba461ceea91b6b77869bdc61e5aa807d4449e8f0d9f880b8d3b45 |

Input: the face box widened to 2.7× / 4.0× around its centre (moved back
inside the frame), resized to 80×80, **BGR, raw 0–255** (the original's
to_tensor does not scale). Output: three logits; after softmax, index 1 is
"real". The original averages the two models' softmax.
