import os
os.environ['PYMUPDF_DISABLE_LAYOUT'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
import fitz
import numpy as np
import json
import glob
import sys
from rapidocr_onnxruntime import RapidOCR

root = r'D:\Business-Management-System\Zen-Ledger-Website-by-eZentix\resorce'
out_dir = r'D:\Business-Management-System\Zen-Ledger-Website-by-eZentix\tmp\pdfs'
ocr = RapidOCR()
records = []
selected = [os.path.join(root, sys.argv[1])] if len(sys.argv) > 1 else sorted(glob.glob(root + r'\*.pdf'))
start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
for path in selected:
    doc = fitz.open(path)
    for index in range(start, min(len(doc), start + limit)):
        pix = doc[index].get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False)
        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        try:
            result, _ = ocr(image)
        except Exception:
            result = None
        text = '\n'.join(item[1] for item in result) if result else ''
        records.append({'file': os.path.basename(path), 'page': index + 1, 'text': text})
    print(os.path.basename(path), len(doc), flush=True)
safe_name = os.path.splitext(os.path.basename(selected[0]))[0].replace(' ', '_')
out = os.path.join(out_dir, f'ocr-{safe_name}-{start}-{limit}.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as stream:
    json.dump(records, stream, ensure_ascii=False, indent=2)
print('wrote', out, len(records))
