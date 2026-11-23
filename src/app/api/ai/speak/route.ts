/**
 * UAS Enterprise — Server-Side Gemini Natural Speech (TTS) API Route
 *
 * Uses @google/genai under v1beta (`gemini-3.8-flash-tts`, cascading cleanly to
 * `gemini-3.8-flash-lite-tts` / `gemini-2.5-pro-preview-tts` on error) with
 * `GEMINI_API_KEY` read strictly on the server.
 *
 * Prepares Yemeni / MSA / English text via `formatSpokenTextForGeminiTts` and
 * streams standard playable `audio/wav` back to the client (falling back cleanly
 * with HTTP 503 `{ fallback: true }` if offline/unconfigured so the browser uses
 * local Web Speech synthesis).
 */
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import {
  formatSpokenTextForGeminiTts,
  type CopilotDialectMode,
} from "@/lib/ai/yemeniLocalization";

export const dynamic = "force-dynamic";

export const DEFAULT_GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-2.5-pro-preview-tts",
];

function wrapPcm16ToWavBuffer(pcmBytes: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBytes.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // Linear PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBytes]);
}

export async function synthesizeGeminiSpeechAudio(params: {
  text: string;
  lang?: "ar" | "en";
  dialect?: CopilotDialectMode;
  voiceName?: string;
  geminiApiKey?: string;
}): Promise<{ ok: true; wavBuffer: Buffer; model: string } | { ok: false; reason: string }> {
  const apiKey = params.geminiApiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "GEMINI_API_KEY_UNCONFIGURED" };
  }

  const lang: "ar" | "en" =
    params.lang === "en" || params.lang === "ar"
      ? params.lang
      : /[\u0600-\u06FF]/.test(params.text)
      ? "ar"
      : "en";
  const dialect: CopilotDialectMode = params.dialect === "msa" ? "msa" : "yemeni";
  const spoken = formatSpokenTextForGeminiTts(params.text, { lang, dialect, maxChars: 680 });
  if (!spoken) {
    return { ok: false, reason: "EMPTY_SPOKEN_TEXT" };
  }

  const configuredPrimary = process.env.UAS_GEMINI_TTS_MODEL?.trim();
  const modelQueue = Array.from(
    new Set([
      ...(configuredPrimary ? [configuredPrimary] : []),
      ...DEFAULT_GEMINI_TTS_MODELS,
    ])
  );

  const voiceName = params.voiceName || (lang === "ar" ? "Orus" : "Aoede");
  const deliveryInstruction =
    lang === "ar"
      ? dialect === "yemeni"
        ? "اقرأ النص التالي بصوت دافئ وهادئ وواضح بنبرة عربية يمنية طبيعية ومحببة بدون زيادة أو تغيير في النص:"
        : "اقرأ النص التالي بصوت دافئ وواضح وبهدوء واتزان بدون أي إضافة:"
      : "Read the following text aloud in a calm, warm, natural advisory voice without adding extra words:";

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  let lastError = "TTS_UNAVAILABLE";

  for (const model of modelQueue) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `${deliveryInstruction}\n\n${spoken}`,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });
      const audioPart = response.candidates?.[0]?.content?.parts?.find(
        (p) => Boolean(p.inlineData?.data)
      );
      const rawData = audioPart?.inlineData?.data;
      const mime = audioPart?.inlineData?.mimeType || "audio/wav";
      if (!rawData) {
        lastError = `${model}: EMPTY_AUDIO_PART`;
        continue;
      }

      const decoded = Buffer.from(rawData, "base64");
      let wavBuffer: Buffer;
      if (mime.toLowerCase().includes("wav") || (decoded.length > 4 && decoded.subarray(0, 4).toString("ascii") === "RIFF")) {
        wavBuffer = decoded;
      } else {
        const rateMatch = mime.match(/rate=(\d+)/i);
        const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
        wavBuffer = wrapPcm16ToWavBuffer(decoded, sampleRate, 1);
      }

      return { ok: true, wavBuffer, model };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[GeminiSpeak] Model ${model} failed:`, lastError.slice(0, 200));
    }
  }

  return { ok: false, reason: lastError };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = String(body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "Text is required", fallback: true }, { status: 400 });
    }
    const lang = body.lang === "en" || body.lang === "ar" ? body.lang : undefined;
    const dialect = body.dialect === "msa" ? "msa" : "yemeni";
    const voiceName = typeof body.voiceName === "string" ? body.voiceName : undefined;

    const result = await synthesizeGeminiSpeechAudio({
      text,
      lang,
      dialect,
      voiceName,
    });

    if (!result.ok) {
      return NextResponse.json(
        { fallback: true, reason: result.reason },
        { status: 503 }
      );
    }

    return new NextResponse(new Uint8Array(result.wavBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-UAS-TTS-Model": result.model,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "TTS failed";
    return NextResponse.json({ fallback: true, reason: msg }, { status: 503 });
  }
}
