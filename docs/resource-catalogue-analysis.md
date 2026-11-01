# Resource Catalogue Analysis

## Source files

The project uses `resorce/` (existing spelling), not `resources/`.

| File | Pages | Extraction result | Current conclusion |
|---|---:|---|---|
| `FM 901-1000.pdf` | 100 | No usable text extracted | Image/design catalogue; requires visual review before import |
| `Luxury photo 01-100.pdf` | 100 | No usable text extracted | Image/design catalogue; requires visual review before import |
| `SDH-100.pdf` | 100 | No usable text extracted | Image/design catalogue; requires visual review before import |
| `STEEL RAJ CATALOG1.pdf` | 6 | No usable text extracted | Image/design catalogue; requires visual review before import |

The PDFs were inspected with `pypdf`. Text extraction returned empty content, so no product names, dimensions, prices, materials, categories, or SKUs are being invented. The files appear to be image-first references and need a page-by-page human review or OCR pipeline before catalogue import.

## Import policy

The backend now provides `ErpCatalogueSource` metadata storage through `/api/erp/catalogue-sources`. It intentionally does not auto-import uncertain PDF content. Admin review is required before creating products, categories, variants, or BOM lines.

Material requirements are configurable by Admin because the source documents do not provide verified consumption quantities.

## Required follow-up

1. Render each PDF page for visual review.
2. Record source filename and page number for each approved product.
3. Capture ambiguous designs as review items rather than guessing.
4. Create products and categories only after Admin confirmation.
5. Add duplicate detection using product code plus normalized name/dimensions.
