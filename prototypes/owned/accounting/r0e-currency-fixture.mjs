// Entirely fictional; figures are chosen to make FX and cash semantics testable.
// Rates are NOT historical market FX observations or trading recommendations.
export const r0eSyntheticCurrencyFixture = Object.freeze({
  synthetic: true,
  accounts: [
    {id:'SYN-CAD-FX-TEST',currency:'CAD',type:'taxable'},
    {id:'SYN-USD-ACCOUNT-TEST',currency:'USD',type:'taxable'},
    {id:'SYN-CAD-CDR-TEST',currency:'CAD',type:'tfsa'}
  ],
  securities: [
    {id:'SYN-USD-TEST',currency:'USD',kind:'equity'},
    {id:'SYN-USD-TEST-2',currency:'USD',kind:'equity'},
    {id:'SYN-CDR-TEST',currency:'CAD',kind:'cdr',underlying:'SYN-USD-REFERENCE'}
  ],
  events: [
    {id:'SYN-E1',date:'2026-01-02',accountId:'SYN-CAD-FX-TEST',type:'deposit',currency:'CAD',amount:'1000'},
    {id:'SYN-E2',date:'2026-01-02',accountId:'SYN-USD-ACCOUNT-TEST',type:'deposit',currency:'USD',amount:'300'},
    {id:'SYN-E3',date:'2026-01-02',accountId:'SYN-CAD-CDR-TEST',type:'deposit',currency:'CAD',amount:'500'},
    {id:'SYN-E4',date:'2026-02-03',accountId:'SYN-CAD-FX-TEST',type:'buy',assetId:'SYN-USD-TEST',currency:'USD',quantity:'2',unitPrice:'100',fee:'2',fxToAccount:'1.30'},
    {id:'SYN-E5',date:'2026-02-04',accountId:'SYN-USD-ACCOUNT-TEST',type:'buy',assetId:'SYN-USD-TEST-2',currency:'USD',quantity:'1',unitPrice:'100',fee:'0'},
    {id:'SYN-E6',date:'2026-02-05',accountId:'SYN-CAD-CDR-TEST',type:'buy',assetId:'SYN-CDR-TEST',currency:'CAD',quantity:'5',unitPrice:'40',fee:'0'},
    {id:'SYN-E7',date:'2026-03-01',accountId:'SYN-CAD-FX-TEST',type:'dividend',assetId:'SYN-USD-TEST',currency:'USD',amount:'10'}
  ],
  quotes: [
    {assetId:'SYN-USD-TEST',currency:'USD',price:'110',fxToAccount:'1.32',quoteSource:'FICTIONAL'},
    {assetId:'SYN-USD-TEST-2',currency:'USD',price:'110',quoteSource:'FICTIONAL'},
    {assetId:'SYN-CDR-TEST',currency:'CAD',price:'55',quoteSource:'FICTIONAL'}
  ]
});
