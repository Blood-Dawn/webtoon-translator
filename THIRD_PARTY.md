# Third party components

This extension ships with two components made by others. Neither is modified.

## Comic text and bubble detector

* File: `models/detector-v4-s_int8.onnx`
* Source: https://huggingface.co/ogkalu/comic-text-and-bubble-detector
* Author: ogkalu
* License: Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
* What it is: an RT-DETR v2 model fine tuned to find speech bubbles and text in manga, webtoons, manhua and western comics. This is its small 8 bit quantized file, about 11 MB.

## ONNX Runtime Web

* Files: `vendor/ort/ort.wasm.min.js`, `vendor/ort/ort-wasm-simd-threaded.mjs`, `vendor/ort/ort-wasm-simd-threaded.wasm`
* Source: https://github.com/microsoft/onnxruntime (npm package `onnxruntime-web` 1.22.0)
* Copyright Microsoft Corporation
* License: MIT

Both run on the reader's own computer. Nothing is downloaded at run time and nothing is sent anywhere.
