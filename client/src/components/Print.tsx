import { isValidEan13 } from '@shared/barcode';
import { CASH_DENOMINATIONS, CASH_MOVEMENT_LABELS, PAYMENT_LABELS, type CashMovementType, type PaymentMethod } from '@shared/types';
import JsBarcode from 'jsbarcode';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fmtDateTime, maskMember, money, qty as fmtQty } from '../lib/format';

// ---------------------------------------------------------------- Mesin cetak
type PrintMode = 'receipt' | 'a4';
const PrintContext = createContext<(node: ReactNode, mode?: PrintMode) => void>(() => {});

export function PrintProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<{ node: ReactNode; mode: PrintMode; id: number } | null>(null);

  useEffect(() => {
    if (!job) return;
    const root = document.getElementById('print-root')!;
    root.className = job.mode === 'a4' ? 'a4' : '';
    // Beri waktu barcode SVG & font selesai dirender.
    const t = setTimeout(() => window.print(), 200);
    const done = () => setJob(null);
    window.addEventListener('afterprint', done, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [job]);

  const print = useCallback((node: ReactNode, mode: PrintMode = 'receipt') => setJob({ node, mode, id: Date.now() }), []);
  return (
    <PrintContext.Provider value={print}>
      {children}
      {job && createPortal(job.node, document.getElementById('print-root')!)}
    </PrintContext.Provider>
  );
}

export const usePrint = () => useContext(PrintContext);

export function Barcode({
  value,
  height = 40,
  width = 1.4,
  fontSize = 11,
  displayValue = true,
  className,
}: {
  value: string;
  height?: number;
  width?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: isValidEan13(value) ? 'EAN13' : 'CODE128',
        height,
        width,
        fontSize,
        margin: 0,
        displayValue,
        font: 'JetBrains Mono',
        background: 'transparent',
      });
    } catch {
      /* nilai tidak valid untuk format barcode */
    }
  }, [value, height, width, fontSize, displayValue]);
  return <svg ref={ref} className={className} />;
}

// ---------------------------------------------------------------- Struk
export interface ReceiptSettings {
  company_name: string;
  company_brand: string;
  company_npwp: string;
  receipt_footer: string;
  point_value: number;
}

const Row = ({ left, right, bold }: { left: ReactNode; right?: ReactNode; bold?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: bold ? 700 : 400 }}>
    <span>{left}</span>
    {right !== undefined && <span style={{ whiteSpace: 'nowrap' }}>{right}</span>}
  </div>
);
const Line = () => <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />;
const Center = ({ children, bold, size }: { children: ReactNode; bold?: boolean; size?: number }) => (
  <div style={{ textAlign: 'center', fontWeight: bold ? 700 : 400, fontSize: size }}>{children}</div>
);

export function Receipt({ sale, settings, copy }: { sale: any; settings: ReceiptSettings; copy?: boolean }) {
  const hasNonPpn = sale.items.some((i: any) => i.tax_type === 'NON_PPN');
  return (
    <div className="receipt">
      <Center bold size={16}>
        {settings.company_brand.toUpperCase()}
      </Center>
      <Center>{settings.company_name}</Center>
      <Center>{sale.store_name}</Center>
      {sale.store_address && <Center>{sale.store_address}</Center>}
      {sale.store_phone && <Center>Telp. {sale.store_phone}</Center>}
      <Center>NPWP {settings.company_npwp}</Center>
      {sale.status === 'VOIDED' && (
        <Center bold size={14}>
          *** TRANSAKSI VOID ***
        </Center>
      )}
      {copy && <Center bold>-- CETAK ULANG --</Center>}
      <Line />
      <Row left="No" right={sale.receipt_no} />
      <Row left="Tanggal" right={fmtDateTime(sale.created_at)} />
      <Row left="Kasir" right={`${sale.cashier_name.split(' ')[0]} / ${sale.terminal_code}`} />
      <Line />
      {sale.items.map((i: any) => (
        <div key={i.id} style={{ marginBottom: 2 }}>
          <div>
            {i.name}
            {i.tax_type === 'NON_PPN' ? ' *' : ''}
          </div>
          <Row left={`  ${fmtQty(i.qty, i.is_weighted)}${i.is_weighted ? ` ${i.unit}` : ''} x ${money(i.unit_price)}`} right={money(i.gross)} />
          {i.discount > 0 && <Row left={`  ${i.promo_name ?? 'Diskon'}`} right={`-${money(i.discount)}`} />}
        </div>
      ))}
      <Line />
      <Row left={`Total Item: ${fmtQty(sale.item_count)}`} />
      <Row left="Subtotal" right={money(sale.subtotal)} />
      {sale.discount_total > 0 && <Row left="Total Hemat" right={`-${money(sale.discount_total)}`} />}
      <Row left="TOTAL" right={money(sale.total)} bold />
      {sale.payments.map((p: any) => (
        <Row key={p.id} left={`${PAYMENT_LABELS[p.method as PaymentMethod]}${p.reference ? ` (${p.reference})` : ''}`} right={money(p.amount)} />
      ))}
      <Row left="Kembalian" right={money(sale.change_amount)} bold />
      <Line />
      <Row left={`DPP ${money(sale.dpp)}`} right={`PPN ${sale.tax_rate}% ${money(sale.tax_amount)}`} />
      {hasNonPpn && <div>* Barang tidak dikenakan PPN</div>}
      {sale.member_no && (
        <>
          <Line />
          <Row left="Member" right={maskMember(sale.member_no)} />
          <Row left="Nama" right={sale.member_name} />
          {sale.points_redeemed > 0 && <Row left="Poin dipakai" right={money(sale.points_redeemed)} />}
          <Row left="Poin didapat" right={money(sale.points_earned)} />
          <Row left="Saldo poin" right={money(sale.member_points)} />
        </>
      )}
      <Line />
      {settings.receipt_footer.split('\n').map((l, i) => (
        <Center key={i}>{l}</Center>
      ))}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <Barcode value={sale.receipt_no} height={32} width={1.1} fontSize={9} displayValue={false} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Laporan shift (X/Z report)
export function ShiftReport({ summary, settings }: { summary: any; settings: ReceiptSettings }) {
  const { shift, sales, voids, returns, payments, movements, cash } = summary;
  const closed = shift.status === 'CLOSED';
  const denoms: Record<string, number> = shift.denominations ? JSON.parse(shift.denominations) : {};
  return (
    <div className="receipt">
      <Center bold size={14}>
        {closed ? 'LAPORAN TUTUP SHIFT (Z)' : 'LAPORAN SEMENTARA (X)'}
      </Center>
      <Center>{settings.company_brand}</Center>
      <Center>
        {shift.store_code} — {shift.store_name}
      </Center>
      <Line />
      <Row left="No. Shift" right={shift.shift_no} />
      <Row left="Kasir" right={shift.cashier_name} />
      <Row left="Terminal" right={shift.terminal_code} />
      <Row left="Buka" right={fmtDateTime(shift.opened_at)} />
      <Row left="Tutup" right={closed ? fmtDateTime(shift.closed_at) : '-'} />
      <Line />
      <Row left="Jumlah transaksi" right={money(sales.trx_count)} />
      <Row left="Penjualan kotor" right={money(sales.gross_total)} />
      <Row left="Diskon/promo" right={`-${money(sales.discount_total)}`} />
      <Row left="Penjualan bersih" right={money(sales.sales_total)} bold />
      <Row left="PPN" right={money(sales.tax_total)} />
      <Row left={`Void (${voids.count})`} right={money(voids.amount)} />
      <Row left={`Retur (${returns.count})`} right={money(returns.amount)} />
      <Line />
      <div style={{ fontWeight: 700 }}>PEMBAYARAN</div>
      {payments.map((p: any) => (
        <Row key={p.method} left={`${PAYMENT_LABELS[p.method as PaymentMethod]} (${p.count})`} right={money(p.amount)} />
      ))}
      <Line />
      <div style={{ fontWeight: 700 }}>REKONSILIASI KAS</div>
      <Row left="Modal awal" right={money(cash.opening)} />
      <Row left="Penjualan tunai" right={money(cash.sales)} />
      <Row left="Kas masuk" right={money(cash.cash_in)} />
      <Row left="Kas keluar" right={`-${money(cash.cash_out)}`} />
      <Row left="Setoran/pickup" right={`-${money(cash.pickup)}`} />
      <Row left="Refund retur" right={`-${money(cash.refunds)}`} />
      <Row left="Kas seharusnya" right={money(closed ? shift.expected_cash : cash.expected)} bold />
      {closed && (
        <>
          <Row left="Kas dihitung" right={money(shift.counted_cash)} bold />
          <Row left="Selisih" right={money(shift.variance)} bold />
          <Line />
          {CASH_DENOMINATIONS.filter((d) => denoms[d]).map((d) => (
            <Row key={d} left={`${money(d)} x ${denoms[d]}`} right={money(d * denoms[d])} />
          ))}
        </>
      )}
      {movements.length > 0 && (
        <>
          <Line />
          <div style={{ fontWeight: 700 }}>MUTASI KAS</div>
          {movements.map((m: any) => (
            <Row key={m.id} left={`${CASH_MOVEMENT_LABELS[m.type as CashMovementType]}: ${m.reason}`} right={money(m.amount)} />
          ))}
        </>
      )}
      <Line />
      <Center>Dicetak {fmtDateTime(new Date().toISOString())}</Center>
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 28 }}>
        <span>( Kasir )</span>
        <span>( Supervisor )</span>
      </div>
    </div>
  );
}
