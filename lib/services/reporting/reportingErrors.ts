export class ReportNotFoundError extends Error {
  readonly code = "REPORT_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  constructor(message = "Report definition not found.") {
    super(message);
    this.name = "ReportNotFoundError";
  }
}

export class UnknownMetricError extends Error {
  readonly code = "UNKNOWN_METRIC";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Unknown or unregistered metric key.") {
    super(message);
    this.name = "UnknownMetricError";
  }
}

export class UnknownDimensionError extends Error {
  readonly code = "UNKNOWN_DIMENSION";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Unknown or unregistered dimension key.") {
    super(message);
    this.name = "UnknownDimensionError";
  }
}

export class UnknownFilterError extends Error {
  readonly code = "UNKNOWN_FILTER";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Unknown or unregistered filter key.") {
    super(message);
    this.name = "UnknownFilterError";
  }
}

export class UnsupportedMetricDimensionCombinationError extends Error {
  readonly code = "UNSUPPORTED_METRIC_DIMENSION_COMBINATION";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested metric cannot be grouped by the requested dimension.") {
    super(message);
    this.name = "UnsupportedMetricDimensionCombinationError";
  }
}

export class InvalidReportDateRangeError extends Error {
  readonly code = "INVALID_REPORT_DATE_RANGE";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested reporting date range is invalid.") {
    super(message);
    this.name = "InvalidReportDateRangeError";
  }
}

export class ReportDateRangeTooLargeError extends Error {
  readonly code = "REPORT_DATE_RANGE_TOO_LARGE";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested range exceeds the maximum span or bucket count for this granularity.") {
    super(message);
    this.name = "ReportDateRangeTooLargeError";
  }
}

export class ReportCardinalityExceededError extends Error {
  readonly code = "REPORT_CARDINALITY_EXCEEDED";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested grouping or scan exceeds the maximum permitted size. Narrow the range or add a filter.") {
    super(message);
    this.name = "ReportCardinalityExceededError";
  }
}

export class ReportExportTooLargeError extends Error {
  readonly code = "REPORT_EXPORT_TOO_LARGE";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested export exceeds the maximum permitted row count.") {
    super(message);
    this.name = "ReportExportTooLargeError";
  }
}

export class ReportScopeViolationError extends Error {
  readonly code = "REPORT_SCOPE_VIOLATION";
  readonly statusCode = 403;
  readonly httpStatus = 403;
  constructor(message = "The requested scope is outside your authorization for this report.") {
    super(message);
    this.name = "ReportScopeViolationError";
  }
}

export class ReportingIdentifierViolationError extends Error {
  readonly code = "REPORTING_IDENTIFIER_VIOLATION";
  readonly statusCode = 500;
  readonly httpStatus = 500;
  constructor(message = "Internal error: a non-registry SQL identifier was rejected.") {
    super(message);
    this.name = "ReportingIdentifierViolationError";
  }
}

export class ReportMetricUnavailableError extends Error {
  readonly code = "REPORT_METRIC_UNAVAILABLE";
  readonly statusCode = 501;
  readonly httpStatus = 501;
  constructor(message = "This metric is not derivable from the current data model.") {
    super(message);
    this.name = "ReportMetricUnavailableError";
  }
}

export class ReportParameterValidationError extends Error {
  readonly code = "REPORT_PARAMETER_VALIDATION_ERROR";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested report parameters are invalid.") {
    super(message);
    this.name = "ReportParameterValidationError";
  }
}

