# Pasar Pagi (agentified)

Situs demo Pasar Pagi Cilacap yang sudah diagentic-kan untuk Open Agentic Web
Challenge. Pengunjung bisa bertanya harga dan stok, mengisi keranjang, dan
membuat pesanan demo — ambil sendiri atau diantar — lewat asisten di halaman.
Semua harga adalah harga contoh, pesanan tidak sungguhan, dan tidak ada
pembayaran.

## Menjalankan

Dari root repo agentic-web:

```shell
node skills/agentify-website/scripts/serve_site.mjs ~/workspace/open-agentic-web/pasar-pagi-agentified --port 8080
```

Lalu buka http://127.0.0.1:8080/. Server ini mengirim header CORS untuk file
publik agen, supaya situs lain bisa memanggil network situs ini.

Buka **⚙ AI model settings**, masukkan key penyedia Anda (default: hosted
Otari, model `alibaba/qwen3.8-flash`), lalu **Save and start**. Pesan Anda dan
data halaman ini dikirim ke penyedia LLM yang Anda pilih. Sesudah selesai,
pilih **Delete setup** di Advanced settings lalu tutup tab.

## File yang ditambahkan skill agentify-website

- `pasar_pagi.hocon` — sumber kebenaran network; `pasar_pagi.network.json`
  dibuat oleh `build_network.mjs`, jangan diedit manual.
- `agent-manifest.json`, `links.json`, `agent-mcp.json`, `.well-known/` —
  file publik agen.
- `site.js` — menyalakan asisten + dialog konfirmasi pesanan demo.
- `site-actions.js` — mendaftarkan action situs.
- `bridge/action-bridge.html`, `bridge/agent-manifest.json` — ditulis build;
  `bridge/bridge-actions.js` — read katalog yang dibagikan ke situs lain.
- `runtime/` — salinan runtime skill (nsdeploy yang dipatch), jangan diubah.
- `tests/` — tes Node untuk network, manifest, action, dan dialog.

## Network

URL network: folder yang memuat `agent-manifest.json`, lalu nama network,
misalnya `http://127.0.0.1:8080/pasar_pagi` (lokal) atau
`https://<host>/pasar_pagi` (hosting).

- Front agent `koordinator_pasar`, spesialis `spesialis_harga_stok` (harga,
  stok, lapak) dan `spesialis_pesanan` (alur pesanan demo).
- Action: `get_market_state` (read), `add_to_cart` (write), `set_cart`
  (write), `checkout_demo_order` (irreversible — dialog konfirmasi, memakai
  `expectedCartVersion`).
- Situs agen lain yang memanggil network ini tidak mendapat tool situs; mereka
  hanya mendapat read katalog lewat bridge, dan asisten mereka mengarahkan
  pengunjung ke halaman ini.

## Hosting statis

Sajikan file-file ini dengan `Access-Control-Allow-Origin: *`:
`agent-manifest.json`, `pasar_pagi.network.json`, `links.json`,
`agent-mcp.json`, dan kedua file `.well-known/`. Sajikan
`runtime/sandbox-worker.js` dengan `Content-Security-Policy: default-src
'none'; script-src blob:; connect-src 'none'; worker-src 'none'`. Jangan
kirim `X-Frame-Options` atau `frame-ancestors` untuk `bridge/`. Pakai HTTPS
di production.

## Cek

```shell
node skills/agentify-website/scripts/build_network.mjs ~/workspace/open-agentic-web/pasar-pagi-agentified/pasar_pagi.hocon --manifest ~/workspace/open-agentic-web/pasar-pagi-agentified/agent-manifest.json --check
node --test "~/workspace/open-agentic-web/pasar-pagi-agentified/tests/*.test.mjs"
node skills/agentify-website/scripts/check_partner.mjs http://127.0.0.1:8080/pasar_pagi
```

## Batasan (dari skill)

- Hosting statis saja, dengan salinan runtime nsdeploy yang dipatch.
- Action `write` berjalan tanpa menampilkan dulu ke pengunjung (spesifikasi
  meminta runtime menampilkannya) — model yang mengikuti teks di jawaban
  partner bisa mengubah state halaman tanpa bertanya.
- Setiap agen bisa melihat semua tool `website_*`.
- Partner hanya mendapat action yang dibagikan `bridge/bridge-actions.js`.
- Tiap panggilan partner berjalan dengan key pengunjung sesudah pengunjung
  setuju, maksimal 4 per pesan dan 1 per partner, dan biayanya lebih dari
  perkiraan token di kartu.
- LLM provider harus mengizinkan CORS.
- File network, termasuk instruksinya, bersifat publik.
