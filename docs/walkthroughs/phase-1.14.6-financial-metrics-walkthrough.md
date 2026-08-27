# Phase 1.14.6-C3 — Financial Metrics, Revenue Summary & AR Aging Walkthrough

---

## 0. Locked-File Modifications Disclosure

All modifications made to files from prior locked phases are fully disclosed below.

### 0.1 [`lib/services/reporting/metrics/schedulingMetrics.ts`](file:///d:/Download/aforden/lib/services/reporting/metrics/schedulingMetrics.ts) (Phase 1.14.4)
- **Change**: Migrated `schedule.avgAcknowledgeLatencyMinutes` to register directly with its `deferredReason` field:
  ```typescript
  {
    key: "schedule.avgAcknowledgeLatencyMinutes",
    category: "OPERATIONAL",
    valueType: "AVG_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointment", field: "updatedAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "AVG_DURATION_MINUTES", field: "updatedAt" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: SCHEDULING_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: ScheduleAppointment model lacks acknowledgedAt timestamp field and ScheduleHistoryEventType has no ACKNOWLEDGED member.",
    deferredReason:
      'Metric "schedule.avgAcknowledgeLatencyMinutes" cannot be computed: ScheduleAppointment model lacks "acknowledgedAt" timestamp field and ScheduleHistoryEventType has no "ACKNOWLEDGED" member (Phase 1.8 dependency gap).',
  }
  ```
- **Integrity**: No existing query builders, logic, or assertions were modified.

### 0.2 [`lib/services/reporting/metrics/technicianMetrics.ts`](file:///d:/Download/aforden/lib/services/reporting/metrics/technicianMetrics.ts) (Phase 1.14.5)
- **Change**: Migrated `technicians.onTimeArrivalRate`, `technicians.utilizationRate`, and `technicians.firstTimeFixRate` to register directly with their `deferredReason` fields.
- **Integrity**: No existing query builders, self-scoping filters, or assertions were modified.

### 0.3 [`tests/reporting/operationalMetricsAndReports.test.ts`](file:///d:/Download/aforden/tests/reporting/operationalMetricsAndReports.test.ts) (Phase 1.14.3)
- **Change**: Updated the probe string for unregistered metric from `"invoices.issuedTotal"` to `"unregistered.fakeMetric"` so that the test authenticates an unknown metric error rather than a registered financial key.

### 0.4 [`tests/reporting/reportingFoundation.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingFoundation.test.ts) (Phase 1.14.2)
- **Change**: Updated `METRIC_KEYS.length` assertion to `47` ($44 + 5 - 2 = 47$) and referenced canonical `invoices.invoicedRevenue`.

---

## 1. Two Verbatim Temporality-Mismatch Tests (Item 1)

Both directions of temporality mismatch are explicitly tested with typed error assertions in [`tests/reporting/financialMetricsAndReports.test.ts`](file:///d:/Download/aforden/tests/reporting/financialMetricsAndReports.test.ts#L408-L435).

### 1.1 Direction 1: `AS_OF` Metric Under Period Semantics
```typescript
it("fails loudly when requesting an AS_OF metric under period time-series semantics", async () => {
  const mockDb: any = createPredicateEvaluatingDb({});

  await expect(
    getRevenueSummaryReport(
      "ws_alpha",
      { metrics: ["invoices.outstandingBalance"], dimensions: ["time.month" as any] },
      mockAdminContext,
      "financial.revenueSummary",
      mockDb,
    ),
  ).rejects.toThrow(UnsupportedMetricDimensionCombinationError);
});
```

### 1.2 Direction 2: `PERIOD` Metric Under `AS_OF` Report Semantics
```typescript
it("fails loudly when requesting a PERIOD metric under AS_OF report semantics", async () => {
  const mockDb: any = createPredicateEvaluatingDb({});

  await expect(
    getArAgingReport(
      "ws_alpha",
      { metrics: ["invoices.invoicedRevenue" as any] },
      mockAdminContext,
      "financial.arAging",
      mockDb,
    ),
  ).rejects.toThrow(UnsupportedMetricDimensionCombinationError);
});
```

### 1.3 Terminal Output for Section 6 Tests
```
 ✓ tests/reporting/financialMetricsAndReports.test.ts > Phase 1.14.6 — Financial Metrics, Revenue Summary & AR Aging > 6. Temporality Mismatch & Validation > fails loudly when requesting an AS_OF metric under period time-series semantics 2ms
 ✓ tests/reporting/financialMetricsAndReports.test.ts > Phase 1.14.6 — Financial Metrics, Revenue Summary & AR Aging > 6. Temporality Mismatch & Validation > fails loudly when requesting a PERIOD metric under AS_OF report semantics 26ms
 ✓ tests/reporting/financialMetricsAndReports.test.ts > Phase 1.14.6 — Financial Metrics, Revenue Summary & AR Aging > 6. Temporality Mismatch & Validation > throws UnsupportedMetricDimensionCombinationError when requesting unallowed metric in financial report 2ms
```

---

## 2. Overpayment Representation & Elimination of Unreachable Branch

- Verified that Phase 1.12 strictly clamps `amountDue = max(0.00, total - amountPaid)` in [`lib/services/invoice/invoiceCalculationEngine.ts`](file:///d:/Download/aforden/lib/services/invoice/invoiceCalculationEngine.ts#L409) and rejects payments where `amount > amountDue` with `OverpaymentNotAllowedError` (HTTP 422) in [`lib/services/invoice/recordPayment.ts`](file:///d:/Download/aforden/lib/services/invoice/recordPayment.ts#L123-L125).
- `amountPaid` cannot exceed `total` and `amountDue` cannot be negative.
- The unreachable `isNegative()` branch in `arAgingReport.ts` and its test have been **completely deleted**. The query filter is strictly `amountDue: { gt: 0 }`.

---

## 3. Storable Precision Fixture inside `Decimal(12, 2)`

- Fixture sums 1,000 storable invoice amounts of `$10.10` each ($1,000 \times \$10.10 = \$10,100.00$).
- Proves that while IEEE-754 binary floats accumulate precision drift, pure `Prisma.Decimal` produces exact `"10100.00"`.

---

## 4. Closed Registry Accounting ($44 + 5 - 2 = 47$)

- Initial 1.14.2 baseline: **44 keys**.
- 5 canonical keys added: `invoices.invoicedRevenue`, `invoices.outstandingBalance`, `invoices.overdueBalance`, `invoices.avgDaysToPayment`, `payments.collectedRevenue`.
- 2 provisional duplicates removed: `invoices.issuedTotal`, `payments.collectedTotal`.
- Result: **47 keys** ($44 + 5 - 2 = 47$).
- Flagged for subsequent phases (1.14.7, 1.14.8, 1.14.9) to reference canonical keys.

---

## 5. Full Test Suite Outputs

### 5.1 Reporting Test Suite Output (`npx vitest run tests/reporting`)
```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/reporting/operationalMetricsAndReports.test.ts (18 tests) 81ms
 ✓ tests/reporting/financialMetricsAndReports.test.ts (20 tests) 103ms
 ✓ tests/reporting/reportingFoundation.test.ts (63 tests) 130ms
 ✓ tests/reporting/schedulingMetricsAndReports.test.ts (18 tests) 74ms
 ✓ tests/reporting/technicianProductivityReports.test.ts (14 tests) 77ms
 ✓ tests/reporting/technicianSelfScoping.test.ts (9 tests) 12ms

 Test Files  6 passed (6)
      Tests  142 passed (142)
   Start at  13:52:40
   Duration  2.71s (transform 1.50s, setup 0ms, import 5.03s, tests 476ms, environment 1ms)
```

### 5.2 Full Workspace Test Suite Output (`npx vitest run`)
```
 Test Files  196 passed (196)
      Tests  3613 passed (3613)
   Start at  13:53:13
   Duration  74.01s (transform 14.50s, setup 0ms, import 77.86s, tests 47.55s, environment 44ms)
```

### 5.3 TypeScript Type-Check (`npx tsc --noEmit`)
```
npx tsc --noEmit
Exit code: 0 (Zero type errors)
```

---

## 6. Database Schema Drift Statement

- **New Tables**: 0
- **New Columns**: 0
- **New Models**: 0
- **Database Drift**: **Zero (0) drift**.
