import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { StatusBadge } from '../components/ui/Primitives';

const TransactionCard = ({ payment }) => {
  const status = payment.status || 'RECORDED';
  const amount = Number(payment.amount) || 0;
  const isCredit = amount >= 0;
  const Icon = isCredit ? ArrowDownLeft : ArrowUpRight;

  return (
    <article className="card card-hover p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isCredit ? 'bg-state-success-bg text-state-success' : 'bg-surface-sunken text-ink-soft'
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-soft">
              {isCredit ? 'Money added' : 'Order payment'}
            </p>
            <p className="tnum text-lg font-bold text-ink">
              {isCredit ? '+' : '-'}₹{Math.abs(amount).toFixed(2)}
            </p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <dl className="mt-3 border-t border-line pt-3">
        <div className="stack-row">
          <dt className="stack-key">Reference</dt>
          <dd className="stack-val break-all font-mono text-xs">{payment.orderId}</dd>
        </div>
        <div className="stack-row">
          <dt className="stack-key">Date</dt>
          <dd className="stack-val">
            {new Date(payment.date).toLocaleDateString('en-IN', {
              year: 'numeric', month: 'short', day: 'numeric',
            })}
          </dd>
        </div>
        {Number.isFinite(payment.balanceAfterMinor) && (
          <div className="stack-row">
            <dt className="stack-key">Balance after</dt>
            <dd className="stack-val tnum">₹{(payment.balanceAfterMinor / 100).toFixed(2)}</dd>
          </div>
        )}
      </dl>
    </article>
  );
};

export default TransactionCard;
