# ETA serialization fixtures

Downloaded on 2026-10-18 from the official ETA SDK page
https://sdk.invoicing.eta.gov.eg/document-serialization-approach/

- `one-doc.json` — https://sdk.invoicing.eta.gov.eg/files/one-doc.json
- `one-doc-serialized.txt` — https://sdk.invoicing.eta.gov.eg/files/one-doc-serialized.json.txt

They are an e-invoice sample, not a receipt. The serialization algorithm is
shared by documents in the SDK, so they are used as a golden test for the
serializer only. They do not prove receipt-level acceptance by ETA.
