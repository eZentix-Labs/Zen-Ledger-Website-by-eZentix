"""
Render product images from the business's own catalogue PDFs (resorce/) into JPEG files plus a
manifest that maps each image to a product SKU. Output goes to a folder you choose (keep it
outside the git repository). Requires PyMuPDF (`pip install pymupdf`).

    python -I scripts/render-catalogue.py ../resorce <out-dir>

Mapping (verified against the rendered pages and OCR on 2026-11-03):
  FM 901-1000.pdf         page n  -> SKU "FM {900+n}"      (Premium Design door prints)
  Luxury photo 01-100.pdf page n  -> SKU "NO-{n:02}"       (Luxury Photo fronts)
  SDH-100.pdf             page n  -> SKU "SDH-{n:02}"      (3-door print renders)
  STEEL RAJ CATALOG1.pdf  page 2  -> 4x4 grid, SKUs SRH-16 ... SRH-20 (catalogue order)
                          pages 3-6 -> two body models per page (left half, right half)
"""
import json
import os
import sys

import fitz  # PyMuPDF

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
manifest = []


def save(pix_page, rect, name, sku, role, file, page, zoom=1.6):
    pix = pix_page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=rect, alpha=False)
    path = os.path.join(out, name)
    pix.save(path, jpg_quality=82)
    manifest.append({"sku": sku, "file": name, "role": role, "source": {"file": file, "page": page}})


def series(pdf, sku_of):
    doc = fitz.open(os.path.join(src, pdf))
    for i, page in enumerate(doc, start=1):
        sku = sku_of(i)
        save(page, page.rect, f"{sku.replace(' ', '_')}.jpg", sku, "main", pdf, i, zoom=0.9)
    doc.close()


series("FM 901-1000.pdf", lambda n: f"FM {900 + n}")
series("Luxury photo 01-100.pdf", lambda n: f"NO-{n:02}")
series("SDH-100.pdf", lambda n: f"SDH-{n:02}")

steel = fitz.open(os.path.join(src, "STEEL RAJ CATALOG1.pdf"))
# Page 2: right-hand half holds a 4x4 grid of door designs with a code label above each tile.
grid = ["SRH-16", "SRH-15", "SRH-13", "SRH-11", "SRH-52", "SRH-50", "SRH-51", "SRH-53",
        "SRH-95", "SRH-07", "SRH-55", "SRH-54", "SRH-22", "SRH-24", "SRH-43", "SRH-20"]
p2 = steel[1]
W, H = p2.rect.width, p2.rect.height
x0, x1, y0, y1 = 0.526 * W, 0.945 * W, 0.105 * H, 0.855 * H
cw, ch = (x1 - x0) / 4, (y1 - y0) / 4
for k, sku in enumerate(grid):
    r, c = divmod(k, 4)
    rect = fitz.Rect(x0 + c * cw, y0 + r * ch + ch * 0.10, x0 + (c + 1) * cw, y0 + (r + 1) * ch - ch * 0.13)  # skip own label above, next row's label below
    save(p2, rect, f"{sku}.jpg", sku, "main", "STEEL RAJ CATALOG1.pdf", 2, zoom=2.4)
# Pages 3-6: two models per page; save the photo band as main image and the full half-page (with specs) as gallery.
models = [("STEEL-HEAVY-3", "STEEL-ECO-2"), ("STEEL-CLASSIC-2", "STEEL-CLASSIC-3"), ("STEEL-ECO-3", "STEEL-CLASSIC-SPL-2"), ("STEEL-PREMIUM-2L", "STEEL-PREMIUM-2")]
for idx, (left, right) in enumerate(models):
    page = steel[idx + 2]
    W, H = page.rect.width, page.rect.height
    for half, sku in ((0, left), (1, right)):
        xa, xb = (0.03 * W, 0.5 * W) if half == 0 else (0.5 * W, 0.97 * W)
        save(page, fitz.Rect(xa, 0.215 * H, xb, 0.53 * H), f"{sku}.jpg", sku, "main", "STEEL RAJ CATALOG1.pdf", idx + 3, zoom=1.8)
        save(page, fitz.Rect(xa, 0.05 * H, xb, 0.84 * H), f"{sku}-specs.jpg", sku, "gallery", "STEEL RAJ CATALOG1.pdf", idx + 3, zoom=1.5)
steel.close()

with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=1)
print(f"rendered {len(manifest)} images to {out}")
