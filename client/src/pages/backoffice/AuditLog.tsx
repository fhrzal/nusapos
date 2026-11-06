import { FileClock } from 'lucide-react';
import { useState } from 'react';
import { Badge, EmptyState, ErrorBox, Field, Loading, PageHeader, Pagination, SearchInput, type Tone } from '../../components/ui';
import { type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { daysAgo, fmtDateTime, isoDate } from '../../lib/format';
import { useDebounced, useFetch } from '../../lib/hooks';

function tone(action: string): Tone {
  if (/FAILED|VOID|CANCEL|DEACTIVATE/.test(action)) return 'red';
  if (/APPROVAL|RETURN|PRICE|PICKUP|CASH/.test(action)) return 'amber';
  if (/LOGIN/.test(action)) return 'gray';
  if (/CREATE|OPEN|RECEIPT|RECEIVE/.test(action)) return 'green';
  return 'blue';
}

export default function AuditLog() {
  const { storeId } = useAuth();
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(isoDate());
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const da = useDebounced(action);
  const { data, error, loading, reload } = useFetch<Paged<any>>('/audit', { store_id: storeId, from, to, action: da, page, limit: 50 });

  return (
    <div>
      <PageHeader title="Audit Trail" description="Jejak seluruh aktivitas sensitif: login, perubahan harga, void, retur, otorisasi supervisor, dan mutasi kas." />
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Dari">
            <input type="date" className="input" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
          </Field>
          <Field label="Sampai">
            <input type="date" className="input" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
          </Field>
          <SearchInput className="min-w-64 flex-1" value={action} onChange={(v) => (setAction(v.toUpperCase()), setPage(1))} placeholder="Filter aksi, mis. VOID, PRICE, APPROVAL" />
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.data.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Pengguna</th>
                    <th>Toko</th>
                    <th>Aksi</th>
                    <th>Objek</th>
                    <th>Detail</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-slate-600">{fmtDateTime(a.created_at)}</td>
                      <td>
                        {a.user_name ?? '—'}
                        <div className="font-mono text-xs text-slate-500">{a.username}</div>
                      </td>
                      <td>{a.store_code ?? 'HQ'}</td>
                      <td>
                        <Badge tone={tone(a.action)}>{a.action}</Badge>
                      </td>
                      <td className="font-mono text-xs text-slate-500">{a.entity ? `${a.entity}#${a.entity_id ?? ''}` : '—'}</td>
                      <td className="max-w-md">
                        {a.details && <code className="block truncate rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600" title={a.details}>{a.details}</code>}
                      </td>
                      <td className="font-mono text-xs text-slate-500">{a.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={50} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={FileClock} title="Tidak ada aktivitas tercatat" />
        )}
      </div>
    </div>
  );
}
