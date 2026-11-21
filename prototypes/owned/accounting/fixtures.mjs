// All identifiers and amounts are fabricated. Never add owner portfolio data here.
const accounts = [
  { id:'SYN-TAXABLE', type:'taxable', currency:'CAD' },
  { id:'SYN-TFSA', type:'tfsa', currency:'CAD' }
];
const securities = [
  { id:'SYN-FUND-FT5', kind:'mutual-fund', currency:'CAD' },
  { id:'SYN-US-EQUITY', kind:'equity', currency:'USD' },
  { id:'SYN-CAD-CDR', kind:'cdr', currency:'CAD', underlying:'SYN-US-UNDERLYING' }
];
const events = [
  {id:'E01',date:'2026-01-02',accountId:'SYN-TAXABLE',type:'deposit',currency:'CAD',amount:'2000'},
  {id:'E02',date:'2026-01-03',accountId:'SYN-TFSA',type:'deposit',currency:'CAD',amount:'500'},
  {id:'E03',date:'2026-01-04',accountId:'SYN-TAXABLE',type:'buy',securityId:'SYN-FUND-FT5',currency:'CAD',quantity:'10',price:'20',fee:'5'},
  {id:'E04',date:'2026-01-05',accountId:'SYN-TFSA',type:'buy',securityId:'SYN-CAD-CDR',currency:'CAD',quantity:'5',price:'40',fee:'0'},
  {id:'E05',date:'2026-02-01',accountId:'SYN-TAXABLE',type:'buy',securityId:'SYN-FUND-FT5',currency:'CAD',quantity:'10',price:'30',fee:'5'},
  {id:'E06',date:'2026-03-01',accountId:'SYN-TAXABLE',type:'roc',securityId:'SYN-FUND-FT5',currency:'CAD',amount:'40'},
  {id:'E07',date:'2026-04-01',accountId:'SYN-TAXABLE',type:'dividend',securityId:'SYN-FUND-FT5',currency:'CAD',amount:'20'},
  {id:'E08',date:'2026-05-01',accountId:'SYN-TAXABLE',type:'sell',securityId:'SYN-FUND-FT5',currency:'CAD',quantity:'4',price:'40',fee:'4'},
  {id:'E09',date:'2026-05-03',accountId:'SYN-TFSA',type:'sell',securityId:'SYN-CAD-CDR',currency:'CAD',quantity:'1',price:'50',fee:'0'},
  {id:'E10',date:'2026-06-01',accountId:'SYN-TAXABLE',type:'drip',securityId:'SYN-FUND-FT5',currency:'CAD',amount:'18',quantity:'0.6',price:'30',fee:'0'},
  {id:'E11',date:'2026-06-03',accountId:'SYN-TAXABLE',type:'notional',securityId:'SYN-FUND-FT5',currency:'CAD',amount:'8'},
  {id:'E12',date:'2026-07-01',accountId:'SYN-TAXABLE',type:'deposit',currency:'CAD',amount:'300'},
  {id:'E13',date:'2026-07-02',accountId:'SYN-TAXABLE',type:'buy',securityId:'SYN-US-EQUITY',currency:'USD',quantity:'2',price:'100',fee:'2',fxToCad:'1.30'}
];
const quotes = [
  {securityId:'SYN-FUND-FT5',currency:'CAD',price:'35'},
  {securityId:'SYN-US-EQUITY',currency:'USD',price:'110',fxToCad:'1.32'},
  {securityId:'SYN-CAD-CDR',currency:'CAD',price:'55'}
];
export const goldSyntheticFixture = Object.freeze({ synthetic:true, accounts, securities, events, quotes });
