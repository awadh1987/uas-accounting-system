import fs from "node:fs";
import path from "node:path";

const target = process.argv[2] === "postgresql" ? "postgresql" : "sqlite";
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const content = fs.readFileSync(schemaPath, "utf8");

const updated = content.replace(
  /provider\s*=\s*"(sqlite|postgresql)"/,
  `provider = "${target}"`
);

if (updated === content) {
  console.log(`prisma/schema.prisma already uses provider = "${target}".`);
} else {
  fs.writeFileSync(schemaPath, updated, "utf8");
  console.log(`Switched prisma/schema.prisma datasource provider to "${target}".`);
}

