import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: `https://s3.${process.env.S3_REGION}.scw.cloud`,
  credentials: {
    accessKeyId: process.env.SCW_ACCESS_KEY,
    secretAccessKey: process.env.SCW_SECRET_KEY,
  },
});

await s3.send(
  new PutBucketCorsCommand({
    Bucket: process.env.S3_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ["*"],
          AllowedMethods: ["PUT"],
          AllowedHeaders: ["*"],
        },
      ],
    },
  })
);

console.log("CORS configured successfully on bucket:", process.env.S3_BUCKET);
