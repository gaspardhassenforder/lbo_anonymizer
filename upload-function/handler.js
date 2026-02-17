import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: `https://s3.${process.env.S3_REGION}.scw.cloud`,
  credentials: {
    accessKeyId: process.env.SCW_ACCESS_KEY,
    secretAccessKey: process.env.SCW_SECRET_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function handle(event, context, cb) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  return handleUpload(event);
}

async function handleUpload(event) {
  try {
    const body = JSON.parse(event.body);
    const { sessionId, type, filename, data } = body;

    if (!sessionId || !type || !data) {
      return respond(400, { error: "Missing sessionId, type, or data" });
    }

    let key, contentType, buffer;

    if (type === "pdf") {
      if (!filename) {
        return respond(400, { error: "Missing filename for PDF upload" });
      }
      // PDF is sent as base64-encoded string
      key = `${sessionId}/${filename}`;
      contentType = "application/pdf";
      buffer = Buffer.from(data, "base64");
    } else if (type === "questionnaire") {
      // Questionnaire is sent as a JSON object
      key = `${sessionId}/questionnaire.json`;
      contentType = "application/json";
      buffer = Buffer.from(JSON.stringify(data, null, 2));
    } else {
      return respond(400, { error: "Invalid type. Use 'pdf' or 'questionnaire'" });
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    return respond(200, { success: true, key });
  } catch (err) {
    return respond(500, { error: "Upload failed", details: err.message });
  }
}
