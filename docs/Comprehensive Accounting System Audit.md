# Comprehensive Accounting System Audit

## 1. Role and Responsibility
Act as a specialized technical and accounting audit committee (**Enterprise Accounting & ERP Audit Team**) comprising the following expertise:
- ERP Systems and Financial Accounting Expert
- Chartered Accountant and IFRS / IAS Standards Expert
- General Ledger and Financial Management Expert
- Accounts Payable & Accounts Receivable Expert
- Cost Accounting & Management Accounting Expert
- Financial Reporting & Consolidation Expert
- Software Engineer Specialized in Enterprise Financial Systems
- Database and Financial Transaction Integrity Expert
- Accounting Systems Security and Permissions Expert
- Systems Integration and Software Testing Expert

Your task is to conduct a comprehensive, independent audit of the accounting system and determine its completeness against best practices and the requirements of professional, global enterprise accounting systems.

## 2. Primary Objective
Examine the entire system to identify:
- All existing accounting modules and components.
- Accounting functions actually implemented.
- Partially implemented or incomplete functions.
- Missing functions that the system must contain.
- Functions present in code that do not work properly.
- Accounting operations that do not produce valid journal entries.
- Integration gaps between modules.
- Internal control and financial audit gaps.
- Reporting and financial statement gaps.
- Technical deficiencies that threaten data integrity and balances.
- System compliance with accounting requirements and relevant standards.
- All improvements required to reach an enterprise-grade professional accounting system.

Do not limit your review to existing functions; also identify everything that must be present in any professional accounting system even if there is currently no trace of it in the codebase.

## 3. Audit Scope
Inspect all available sources, including:
- Backend source code
- Frontend user interfaces
- Databases, tables, and relationships
- Entities, Aggregates, and Value Objects
- Commands, Queries, and Handlers
- Services and Repositories
- APIs and Endpoints
- DTOs and Validators
- Events, Event Handlers, and Message Consumers
- Chart/posting configurations and automated posting rules
- Financial reports and queries
- Permissions and access policies
- Unit / Integration / Functional / UI tests
- System documentation and diagrams
- Configuration files and Database Migrations

Trace each feature from the user interface through the API, Application, Domain, and Infrastructure layers down to the database, and do not treat the mere existence of a screen or Entity as sufficient proof that a feature is complete.

## 4. Comprehensive Functional Audit Checklist
Examine all of the following areas without exception:

### A. Financial Foundation & Accounting Configuration
- Financial entity / company settings
- Chart of Accounts
- Account types and normal balances/natures
- Account hierarchy levels, roll-up/grouping, and posting flags
- Control Accounts
- Automated posting configurations
- Default accounts linked to operations
- Currency, precision, and rounding settings
- Fiscal years and accounting periods configuration
- Accounting dimensions configuration
- Accounting policies
- Document reference numbering management

### B. General Ledger
- Journal Entries
- Manual Journals
- Recurring Journals
- Reversing Journals
- Accrual Entries
- Adjustment Entries
- Opening Balances
- Journal Approval
- Journal Posting
- Journal Reversal
- General Ledger
- Trial Balance
- Account Ledger
- Account Reconciliation
- Suspense Accounts
- Intercompany Journals
- Journal Audit Trail

### C. Accounts Receivable (AR)
- Customer and balance management
- Sales invoices
- Debit and credit notes
- Receipts and collection vouchers
- Advance payments / customer deposits
- Customer settlements
- Aging Analysis
- Credit Limits
- Customer Statements
- Payment Allocation
- Bad Debt Provision
- Write-off Management
- Revenue Recognition

### D. Accounts Payable (AP)
- Vendor management
- Purchase invoices
- Debit and credit notes
- Payment vouchers
- Advance payments / vendor deposits
- Payment scheduling
- Three-way / invoice matching with purchase orders and goods receipts
- Vendor Reconciliation
- AP Aging
- Supplier Statements
- Withholding Tax
- Duplicate Invoice Detection

### E. Cash & Bank Management
- Cash Accounts
- Cash Receipts
- Cash Payments
- Bank Accounts
- Bank Transfers
- Cheque Management
- Post-dated Cheques
- Bank Reconciliation
- Cash Flow
- Cash Forecasting
- Petty Cash
- Cash Position Reporting
- Bank Statement Import
- Automatic Matching

### F. Multi-Currency Management
- Multi-currency support
- Base currency, functional currency, and presentation currency
- Historical exchange rates
- Transaction-specific exchange rates
- Foreign balance revaluation
- Realized Exchange Gain/Loss
- Unrealized Exchange Gain/Loss
- Currency Translation
- Currency Rounding
- Foreign Currency Reconciliation

### G. Fixed Assets Management
- Asset Register
- Asset Categories
- Asset Acquisition
- Asset Capitalization
- Depreciation Methods
- Depreciation Posting
- Asset Transfer
- Asset Disposal
- Asset Revaluation
- Asset Impairment
- Asset Maintenance
- Asset Components
- Asset History
- Asset Reporting

### H. Cost & Management Accounting
- Cost Centers
- Profit Centers
- Cost Elements
- Cost Allocation
- Direct and Indirect Costs
- Overhead Allocation
- Cost Distribution Rules
- Product Costing
- Service Costing
- Project Costing
- Manufacturing Costing
- Standard Costing
- Actual Costing
- Variance Analysis
- Profitability Analysis
- Analytical Dimensions

### I. Budgeting & Financial Planning
- Annual Budgets
- Department Budgets
- Branch Budgets
- Project Budgets
- Cost Center Budgets
- Revenue Budgets
- Expense Budgets
- Budget Approval
- Budget Revision
- Budget Control
- Actual vs Budget
- Variance Analysis
- Budget Alerts
- Financial Forecasting
- Rolling Forecasts

### J. Tax Management
- Tax Configuration
- VAT
- Withholding Tax
- Sales Tax
- Purchase Tax
- Tax Exemptions
- Tax Rates by Effective Date
- Tax Calculation
- Tax Reconciliation
- Tax Returns
- Tax Reports
- Tax Audit Trail

### K. Financial Closing & Fiscal Year Management
- Fiscal Year Setup
- Accounting Period Management
- Period Opening and Closing
- Period Locking
- Month-End Closing
- Year-End Closing
- Accruals and Adjustments
- Depreciation Closing
- Inventory Reconciliation
- Revenue and Expense Closing
- Profit and Loss Closing
- Retained Earnings
- Opening Balance Carry Forward
- Prior Period Adjustments
- Post-Closing Trial Balance

### L. Financial Statements & Reporting
- General Ledger Reports
- Journal Reports
- Trial Balance
- Balance Sheet
- Income Statement
- Cash Flow Statement
- Statement of Changes in Equity
- Notes to Financial Statements
- Accounts Receivable Reports
- Accounts Payable Reports
- Aging Reports
- Bank Reconciliation Reports
- Fixed Assets Reports
- Depreciation Reports
- Cost Accounting Reports
- Budget vs Actual Reports
- Tax Reports
- Financial Ratios
- Profitability Reports
- Consolidated Financial Statements
- Comparative Financial Statements
- Drill-down to Source Documents
- Export to Excel and PDF

### M. Financial Consolidation & Multi-Company
- Multi-Company Accounting
- Intercompany Transactions
- Intercompany Reconciliation
- Consolidation
- Elimination Entries
- Currency Translation
- Consolidated Financial Statements
- Group Chart of Accounts
- Company-to-Group Account Mapping

### N. Internal Control & Financial Governance
- Segregation of Duties
- Role-Based Access Control
- Approval Workflows
- Multi-Level Approval
- Posting Permissions
- Period Lock Permissions
- Audit Trail
- Change History
- Financial Document Traceability
- Duplicate Transaction Prevention
- Unauthorized Posting Prevention
- Financial Limits
- Exception Monitoring
- Fraud Indicators
- Reversal Controls

### O. Accounting Standards & Compliance
Examine the system's support for requirements related to the following standards:
- **IAS 1**: Presentation of Financial Statements
- **IAS 2**: Inventories
- **IAS 7**: Statement of Cash Flows
- **IAS 8**: Accounting Policies and Errors
- **IAS 10**: Events after Reporting Period
- **IAS 12**: Income Taxes
- **IAS 16**: Property, Plant and Equipment
- **IAS 19**: Employee Benefits
- **IAS 21**: Foreign Exchange Rates
- **IAS 36**: Impairment of Assets
- **IAS 37**: Provisions and Contingencies
- **IFRS 9**: Financial Instruments
- **IFRS 15**: Revenue from Contracts
- **IFRS 16**: Leases

Do not assume that the mere presence of a screen or setting indicates compliance with a standard. Inspect the actual accounting implementation, and identify which requirements apply to the nature of the entity and which require specialized evaluation.

### P. ERP Financial Integration
Examine accounting integration with:
- Sales
- Purchasing
- Inventory
- Point of Sale
- Payroll
- Human Resources
- Fixed Assets
- Manufacturing
- Projects
- Contracts
- Expenses
- Warehouse Operations
- Banking
- Tax Management

Trace each financially impactful operation and specify:
- Source document
- Emitted event
- Debit and credit accounts
- Transaction amount
- Currency and exchange rate
- Branch and cost center
- Resulting journal entry
- Posting timing
- Approval mechanism
- Potential for duplication or event loss
- Traceability from journal entry back to source document

## 5. Deep Technical Audit
Examine the following aspects:

- **Financial Data Integrity**: Use of `Decimal` for monetary amounts; calculation and rounding accuracy; journal entry balancing; integrity of relationships between accounts and journal lines; no loss of financial parts of transactions; no unreconciled balances.
- **Transaction Management**: ACID transactions; atomic posting; optimistic concurrency; idempotency; duplicate prevention; transactional outbox; event reliability; retry and recovery; dead letter handling.
- **Accounting Engine**: Centralization of journal creation rules; no duplication of posting logic across modules; no unjustified default accounts or currencies; no unsafe fallback exchange rates; disallowing posting of incomplete journal entries; preventing modification of posted entries; proper support for reversals and adjustments.
- **Database Integrity**: Validity of keys and relationships; unique constraints; indexes; concurrency tokens; referential integrity; query performance; historical data integrity; backup and recovery.
- **Multi-Tenancy**: Financial data isolation between tenants; validity of Tenant Context; branch and company isolation; protection of background jobs; protection of events and messages; no data leakage through cache or reports; verification of access permissions to financial data.

## 6. UI & UX Audit
Examine all accounting screens and identify:
- Missing screens
- Incomplete screens
- Missing accounting fields
- Unimplemented action buttons
- Approval, posting, and reversal buttons
- Document statuses
- Validation and error messages
- Search and filtering
- Pagination
- Printing
- PDF and Excel export
- Interactive reports
- Permissions at the screen, button, and action levels
- Alignment of the UI with the actual workflow

Do not treat the existence of a UI as proof of real functionality behind it.

## 7. Testing Audit
Verify the existence and effectiveness of:
- Unit Tests
- Integration Tests
- API Tests
- Database Tests
- Frontend Component Tests
- UI/E2E Tests
- Financial Calculation Tests
- Journal Balancing Tests
- Multi-Currency Tests
- Exchange Revaluation Tests
- Period Closing Tests
- Concurrency Tests
- Idempotency Tests
- Authorization Tests
- Multi-Tenant Isolation Tests
- Accounting Integration Tests
- Financial Regression Tests

Identify critical accounting scenarios that lack tests, and do not treat the mere existence of test files as proof that they pass or cover the domain.

## 8. Strict Rules During the Audit
- Inspect the actual implementation and do not rely on class or file names.
- Do not assume a feature exists just because an Entity, API, or screen exists.
- Do not assume a feature is missing before searching all relevant layers.
- Trace the path of every accounting operation end-to-end.
- Do not invent implementation requirements or findings unsupported by evidence.
- Distinguish between absence of a feature and lack of sufficient evidence to prove it.
- **Do not modify any file, code, or database.**
- **Do not execute any Migration or data migration/deletion operation.**
- **Do not change project settings.**
- Do not rely on quick checks or random samples; perform a comprehensive inventory of all modules and functions.
- Inspect cross-module relationships and integrations.
- Do not treat a successful Build as proof of accounting system correctness.
- Do not treat passing current tests as proof of coverage across all scenarios.
- Do not confuse core accounting functions with optional functions that depend on the nature of the entity.
- If a part cannot be inspected, state the reason clearly and do not issue an unsubstantiated judgment.

## 9. Audit Finding Classifications
Use the following statuses for every requirement:
- **IMPLEMENTED**: Present, complete, and supported by evidence.
- **PARTIALLY IMPLEMENTED**: Present but incomplete.
- **IMPLEMENTED BUT DEFECTIVE**: Present but has a defect.
- **MISSING**: Not found after inspecting the relevant implementation scope.
- **NOT VERIFIED**: Insufficient evidence to prove its status.
- **NOT APPLICABLE**: Not applicable to the entity's nature, with reason stated.

Classify severity as:
- **CRITICAL**: A defect that could corrupt balances or journal entries, cause data loss, or create a serious financial breach.
- **HIGH**: A material gap affecting transaction accuracy, reporting, or control.
- **MEDIUM**: A gap affecting efficiency or professional features.
- **LOW**: Limited improvements or optional capabilities.

## 10. Required Audit Deliverables
Create a folder named:
`docs/accounting-audit/`

And create the following reports:
- `01-Executive-Summary.md`: Executive summary showing overall system status, completion percentage, and key risks.
- `02-Accounting-Modules-Inventory.md`: Comprehensive inventory of all accounting modules, components, and functions.
- `03-Accounting-Requirements-Matrix.md`: Matrix of all requirements with status, evidence, notes, and priority.
- `04-Missing-Features-Report.md`: All missing functions and components with explanation of their importance and impact of absence.
- `05-Accounting-Defects-and-Risks.md`: All discovered accounting and technical defects and risks.
- `06-Financial-Integration-Audit.md`: Audit report of accounting integration across all modules.
- `07-Financial-Reports-Audit.md`: Audit of financial reports and statements, result accuracy, and traceability.
- `08-Security-and-Internal-Control-Audit.md`: Audit of permissions, segregation of duties, audit log, and internal controls.
- `09-Accounting-Standards-Compliance.md`: Matrix of requirements related to IAS and IFRS standards, distinguishing proven implementation from items requiring specialized accounting review.
- `10-Accounting-Testing-Gaps.md`: Report of existing and missing tests and uncovered financial scenarios.
- `11-Recommended-Implementation-Roadmap.md`: Phased implementation roadmap to address gaps ordered by severity, priority, and dependencies.
- `12-Evidence-and-Source-References.md`: Exact evidence references: files, classes, functions, endpoints, tables, relationships, and tests.

## 11. Final Scoring Matrix
Score each domain out of 100, defining weights based on its importance:
- Accounting Core
- General Ledger
- AR & AP
- Cash & Bank
- Multi-Currency
- Fixed Assets
- Cost Accounting
- Budgeting
- Tax Management
- Financial Closing
- Financial Reporting
- Consolidation
- Internal Controls
- ERP Integration
- Technical Integrity
- Testing & Quality

Calculate the overall score using declared, justified weights, and do not award points for unverified requirements. Display the score across tiers:
- **Less than 40%**: Weak
- **40% to less than 60%**: Limited
- **60% to less than 75%**: Moderate
- **75% to less than 90%**: Advanced
- **90% to 100%**: Very Advanced

Do not allow high average scores to mask any critical defect in posting integrity, financial data, or security isolation.

## 12. Required Final Answers
Provide clear answers to the following questions:
- Is the accounting system genuinely integrated?
- Which accounting modules exist?
- Which modules are completely missing?
- Which modules are partially implemented?
- Which accounting operations do not work properly?
- Is the journal entry and posting lifecycle sound?
- Can balances and financial statements be trusted?
- Are currencies and exchange rates handled properly?
- Is period and year-end closing complete?
- Are internal controls and permissions sufficient?
- Is cross-module integration accurate and reliable?
- Are there core requirements of professional accounting systems that are unsupported?
- What risks prevent adopting the system for live use?
- What must be implemented first?
- What is the true maturity level of the system compared to enterprise accounting systems?

## Final Directive
Execute a thorough, accurate, and independent audit—not a superficial code review.
Absolute priority is accounting accuracy, financial data integrity, integration, and internal control—not the number of screens, classes, or software modules.
**Do not start any fix or modification.** The objective at this stage is inspection, documentation, evaluation, and identifying all gaps only.
Reports must be detailed and verifiable, grounded in actual system evidence, with a clear distinction between proven facts, conclusions, risks, and unverified functions.
```[cite: 10]
