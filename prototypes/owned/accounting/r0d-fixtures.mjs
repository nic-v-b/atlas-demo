// All data are deliberately invented and independent of the owner's portfolio.
// These are small scenario-specific acceptance fixtures, never real securities.
export const syntheticDistributions = {
  synthetic: true,
  accounts: [{ id:'SYN-DISTRIBUTIONS', type:'taxable', currency:'CAD' }],
  securities: [{ id:'SYN-DIST-FUND', kind:'mutual-fund', currency:'CAD' }],
  events: [
    { id:'D01',date:'2026-01-02',accountId:'SYN-DISTRIBUTIONS',type:'deposit',currency:'CAD',amount:'1000' },
    { id:'D02',date:'2026-01-05',accountId:'SYN-DISTRIBUTIONS',type:'buy',securityId:'SYN-DIST-FUND',currency:'CAD',quantity:'10',price:'20',fee:'0' },
    { id:'D03',date:'2026-02-01',accountId:'SYN-DISTRIBUTIONS',type:'roc',securityId:'SYN-DIST-FUND',currency:'CAD',amount:'20' },
    { id:'D04',date:'2026-03-01',accountId:'SYN-DISTRIBUTIONS',type:'drip',securityId:'SYN-DIST-FUND',currency:'CAD',quantity:'1',price:'25',fee:'0',amount:'25' },
    { id:'D05',date:'2026-04-01',accountId:'SYN-DISTRIBUTIONS',type:'notional',securityId:'SYN-DIST-FUND',currency:'CAD',amount:'10' }
  ],
  quotes: [{securityId:'SYN-DIST-FUND',currency:'CAD',price:'30'}]
};
export const syntheticFxAndCdr = {
  synthetic: true,
  accounts: [
    {id:'SYN-FX-TAXABLE',type:'taxable',currency:'CAD'},
    {id:'SYN-CDR-TFSA',type:'tfsa',currency:'CAD'}
  ],
  securities: [
    {id:'SYN-USD-ISSUER',kind:'equity',currency:'USD'},
    {id:'SYN-CDR-ISSUER',kind:'cdr',currency:'CAD',underlying:'SYN-USD-UNDERLYING'}
  ],
  events: [
    {id:'F01',date:'2026-01-02',accountId:'SYN-FX-TAXABLE',type:'deposit',currency:'CAD',amount:'1000'},
    {id:'F02',date:'2026-01-02',accountId:'SYN-CDR-TFSA',type:'deposit',currency:'CAD',amount:'500'},
    {id:'F03',date:'2026-02-03',accountId:'SYN-FX-TAXABLE',type:'buy',securityId:'SYN-USD-ISSUER',currency:'USD',quantity:'2',price:'100',fee:'2',fxToCad:'1.30'},
    {id:'F04',date:'2026-02-04',accountId:'SYN-CDR-TFSA',type:'buy',securityId:'SYN-CDR-ISSUER',currency:'CAD',quantity:'5',price:'40',fee:'0'}
  ],
  quotes: [
    {securityId:'SYN-USD-ISSUER',currency:'USD',price:'110',fxToCad:'1.32'},
    {securityId:'SYN-CDR-ISSUER',currency:'CAD',price:'55'}
  ]
};
export const syntheticTaxablePoolingGap = {
  synthetic:true,
  accounts: [
    {id:'SYN-TAX-A',type:'taxable',currency:'CAD'},
    {id:'SYN-TAX-B',type:'taxable',currency:'CAD'},
    {id:'SYN-TFSA-OTHER',type:'tfsa',currency:'CAD'}
  ],
  securities:[{id:'SYN-IDENTICAL-ASSET',kind:'etf',currency:'CAD'}],
  events:[
    {id:'P01',date:'2026-01-02',accountId:'SYN-TAX-A',type:'deposit',currency:'CAD',amount:'500'},
    {id:'P02',date:'2026-01-02',accountId:'SYN-TAX-B',type:'deposit',currency:'CAD',amount:'500'},
    {id:'P03',date:'2026-01-02',accountId:'SYN-TFSA-OTHER',type:'deposit',currency:'CAD',amount:'500'},
    {id:'P04',date:'2026-02-01',accountId:'SYN-TAX-A',type:'buy',securityId:'SYN-IDENTICAL-ASSET',currency:'CAD',quantity:'10',price:'20',fee:'0'},
    {id:'P05',date:'2026-02-02',accountId:'SYN-TAX-B',type:'buy',securityId:'SYN-IDENTICAL-ASSET',currency:'CAD',quantity:'10',price:'40',fee:'0'},
    {id:'P06',date:'2026-02-03',accountId:'SYN-TFSA-OTHER',type:'buy',securityId:'SYN-IDENTICAL-ASSET',currency:'CAD',quantity:'10',price:'50',fee:'0'},
    {id:'P07',date:'2026-03-01',accountId:'SYN-TAX-A',type:'sell',securityId:'SYN-IDENTICAL-ASSET',currency:'CAD',quantity:'5',price:'30',fee:'0'}
  ],
  quotes: [{securityId:'SYN-IDENTICAL-ASSET',currency:'CAD',price:'30'}]
};
