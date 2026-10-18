import { z } from 'zod';
import { DECIMAL_STRING_RE, dec } from '../../common/money/decimal.js';

const price = z.string().regex(DECIMAL_STRING_RE).refine((v) => dec(v).gte(0), 'Price cannot be negative');

export const ProductBody = z.object({
  kind: z.enum(['GOODS', 'SERVICE']),
  internalCode: z.string().min(1).max(50),
  barcode: z.string().regex(/^[0-9A-Za-z-]{4,64}$/).nullable().optional(),
  nameAr: z.string().min(1).max(200),
  nameEn: z.string().max(200).nullable().optional(),
  description: z.string().min(1).max(500),
  etaItemType: z.enum(['GS1', 'EGS']),
  etaItemCode: z.string().min(1).max(100),
  unitType: z.string().min(1).max(30),
  unitPrice: price,
  taxCodes: z.array(z.string().regex(/^[A-Z0-9_]{2,40}$/)).min(1).max(5),
  isActive: z.boolean().optional(),
});

