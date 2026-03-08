/**
 * File Upload API Route
 */
import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";   
import { auth } from "@clerk/nextjs/server";
import { ALLOWED_AUDIO_TYPES } from "@/lib/constants";
import { PLAN_LIMITS } from "@/lib/tier-config";

const getOrigin = (request: Request) => {
  const origin = request.headers.get('origin');
  if (process.env.NODE_ENV !== 'production') {
    return origin || '*';
  }
  return 'https://podly-one.vercel.app';
};

const getCorsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
});

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 200,
    headers: getCorsHeaders(getOrigin(request)),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = getOrigin(request);
  const corsHeaders = getCorsHeaders(origin);

  try {
    const authObj = await auth();
    const { userId, has } = authObj;

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" }, 
        { status: 401, headers: corsHeaders }
      );
    }

    const body = (await request.json()) as HandleUploadBody;

    let maxFileSize = PLAN_LIMITS.free.maxFileSize;
    if (has?.({ plan: "ultra" })) {
      maxFileSize = PLAN_LIMITS.ultra.maxFileSize;
    } else if (has?.({ plan: "pro" })) {
      maxFileSize = PLAN_LIMITS.pro.maxFileSize;
    }

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        return {
          allowedContentTypes: ALLOWED_AUDIO_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: maxFileSize,
          tokenPayload: JSON.stringify({ userId }),
        };
      },
      // ADDED: This property is required by the SDK type definition
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This code runs on Vercel's servers after the upload is done.
        // It won't be called on localhost, but it MUST be defined.
        console.log("Upload completed server-side:", blob.url);
      },
    });

    return NextResponse.json(jsonResponse, {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error("[UPLOAD] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400, headers: corsHeaders }
    );
  }
}