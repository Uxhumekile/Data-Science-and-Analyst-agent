import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  try {
    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return supabaseClient;
  } catch (err) {
    console.warn("[supabase] Failed to initialize Supabase client:", err);
    return null;
  }
}

export function getSupabaseBucketName(): string {
  return (
    process.env.SUPABASE_STORAGE_BUCKET ||
    process.env.SUPABASE_BUCKET ||
    "analyst-uploads"
  );
}

export interface SupabaseUploadResult {
  path: string;
  bucket: string;
  url?: string;
  signedUrl?: string;
}

export async function uploadFileToSupabase(params: {
  buffer: Buffer;
  originalName: string;
  mimeType?: string;
  sessionId?: string;
}): Promise<SupabaseUploadResult | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const bucket = getSupabaseBucketName();
  const sessionId = params.sessionId || "default";
  const safeName = params.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const filePath = `uploads/${sessionId}/${uniqueSuffix}-${safeName}`;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, params.buffer, {
        contentType: params.mimeType || "text/csv",
        upsert: true,
      });

    if (error) {
      console.warn(`[supabase] Storage upload warning for bucket '${bucket}':`, error.message);
      return null;
    }

    // Attempt to get public URL
    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    // Also generate a signed URL (valid for 24h) in case the bucket is private
    let signedUrl: string | undefined = undefined;
    try {
      const { data: signedData } = await supabase.storage
        .from(bucket)
        .createSignedUrl(filePath, 60 * 60 * 24);
      if (signedData?.signedUrl) {
        signedUrl = signedData.signedUrl;
      }
    } catch {
      // Ignore signed URL failure if bucket is public
    }

    console.log(`[supabase] Uploaded ${params.originalName} to Supabase bucket '${bucket}' at '${filePath}'`);

    return {
      path: filePath,
      bucket,
      url: publicUrlData?.publicUrl || signedUrl,
      signedUrl,
    };
  } catch (err: any) {
    console.warn(`[supabase] Upload failed for ${params.originalName}:`, err.message || err);
    return null;
  }
}

export async function deleteSupabaseFiles(paths: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase || paths.length === 0) return;

  const bucket = getSupabaseBucketName();
  try {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.warn("[supabase] Failed to delete files:", error.message);
    }
  } catch (err: any) {
    console.warn("[supabase] Error deleting files:", err.message || err);
  }
}
