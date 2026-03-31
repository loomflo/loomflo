/**
 * Error thrown when a workflow exceeds its configured budget limit.
 *
 * Contains the total cost incurred and the budget limit that was exceeded,
 * enabling callers to report the exact amounts in logs and UI.
 */
export class BudgetExceededError extends Error {
  /** The total cost in USD at the time the budget was exceeded. */
  readonly totalCost: number;

  /** The configured budget limit in USD that was exceeded. */
  readonly budgetLimit: number;

  /**
   * Creates a new BudgetExceededError.
   *
   * @param totalCost - The total cost in USD at the time of the check.
   * @param budgetLimit - The configured budget limit in USD.
   */
  constructor(totalCost: number, budgetLimit: number) {
    super(
      `Budget limit of $${String(budgetLimit)} exceeded (current total: $${String(totalCost)})`,
    );
    this.name = "BudgetExceededError";
    this.totalCost = totalCost;
    this.budgetLimit = budgetLimit;
  }
}
