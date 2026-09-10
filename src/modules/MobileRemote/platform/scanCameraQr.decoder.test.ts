import decode from "jsqr";
import { expect, it } from "vitest";

import { parseMobileRemoteWsUrl } from "../connection/parseMobileRemoteWsUrl";

// The same encoder used by Desktop, rather than a mocked decoder response.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createQr = require("../../../util/qr/qrcodeGeneratorVendor.js") as (
  version: number,
  level: string
) => {
  addData(value: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, column: number): boolean;
};
it("decodes Desktop-generated QR pixels into the existing pairing parser", () => {
  const payload = "wss://relay.example.com/mobile/ws?token=test";
  const qr = createQr(0, "M");
  qr.addData(payload);
  qr.make();
  const modules = qr.getModuleCount();
  const size = (modules + 8) * 6;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / 6) - 4;
      const column = Math.floor(x / 6) - 4;
      if (
        row >= 0 &&
        column >= 0 &&
        row < modules &&
        column < modules &&
        qr.isDark(row, column)
      ) {
        const offset = (y * size + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
  const result = decode(pixels, size, size);
  expect(result?.data).toBe(payload);
  expect(parseMobileRemoteWsUrl(result!.data).ok).toBe(true);
});
