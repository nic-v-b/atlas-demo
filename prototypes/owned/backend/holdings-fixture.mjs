// Original ATLAS synthetic Holdings fixture; every label, price and amount is invented.
// Do not replace these values with actual bank, brokerage, account or holding records.
export const holdingsFixture = Object.freeze({
  synthetic:true,
  asOf:'2026-11-01',
  accounts:[
    {id:'SYN-CAD-TAX',label:'Fictional CAD taxable',type:'taxable',currency:'CAD',ownerId:'SYN-OWNER-1'},
    {id:'SYN-CAD-TFSA',label:'Fictional CAD TFSA',type:'tfsa',currency:'CAD',ownerId:'SYN-OWNER-1'},
    {id:'SYN-USD-TEST',label:'Fictional USD account',type:'taxable',currency:'USD',ownerId:'SYN-OWNER-1'}
  ],
  securities:[
    {id:'SYN-ETF-1',symbol:'SYNETF01',name:'Fictional Global Diversified ETF',kind:'etf',currency:'CAD',
      analysis:{asOf:'2026-11-01',strategy:'global-diversified-etf',
        sectors:[{key:'technology',weight:'25'},{key:'financials',weight:'20'},
          {key:'healthcare',weight:'15'},{key:'industrials',weight:'15'},
          {key:'consumer',weight:'15'},{key:'other',weight:'10'}],
        geographies:[{key:'us',weight:'50'},{key:'canada',weight:'20'},
          {key:'developed',weight:'20'},{key:'emerging',weight:'10'}]}},
    {id:'SYN-ETF-TECH',symbol:'SYNTECH01',name:'Fictional Technology Sector ETF',kind:'etf',currency:'CAD',
      analysis:{asOf:'2026-11-01',strategy:'technology-sector-etf',
        sectors:[{key:'technology',weight:'100'}],
        geographies:[{key:'us',weight:'80'},{key:'developed',weight:'15'},{key:'canada',weight:'5'}]}},
    {id:'SYN-EQUITY-1',symbol:'SYNSTK01',name:'Fictional Canadian Financial Equity',kind:'equity',currency:'CAD',
      analysis:{asOf:'2026-11-01',strategy:'direct-financial-stock',
        sectors:[{key:'financials',weight:'100'}],
        geographies:[{key:'canada',weight:'100'}]}},
    {id:'SYN-CDR-1',symbol:'SYNCDR01',name:'Fictional Technology CAD Receipt',kind:'cdr',currency:'CAD',
      analysis:{asOf:'2026-11-01',strategy:'cdr-technology',
        sectors:[{key:'technology',weight:'100'}],
        geographies:[{key:'us',weight:'100'}]}},
    {id:'SYN-USD-1',symbol:'SYNUSD01',name:'Fictional US Healthcare Equity',kind:'equity',currency:'USD',
      analysis:{asOf:'2026-11-01',strategy:'direct-healthcare-stock',
        sectors:[{key:'healthcare',weight:'100'}],
        geographies:[{key:'us',weight:'100'}]}}
  ],
  events:[
    {id:'SYN-J1',date:'2026-01-02',seq:1,accountId:'SYN-CAD-TAX',type:'deposit',currency:'CAD',amount:'10000'},
    {id:'SYN-J2',date:'2026-01-03',seq:1,accountId:'SYN-CAD-TFSA',type:'deposit',currency:'CAD',amount:'5000'},
    {id:'SYN-J3',date:'2026-01-04',seq:1,accountId:'SYN-USD-TEST',type:'deposit',currency:'USD',amount:'3000'},
    {id:'SYN-J4',date:'2026-02-01',seq:1,accountId:'SYN-CAD-TAX',type:'buy',securityId:'SYN-ETF-1',currency:'CAD',quantity:'10',unitPrice:'150',fee:'0'},
    {id:'SYN-J4B',date:'2026-02-01',seq:2,accountId:'SYN-CAD-TAX',type:'buy',securityId:'SYN-ETF-TECH',currency:'CAD',quantity:'10',unitPrice:'150',fee:'0'},
    {id:'SYN-J5',date:'2026-02-02',seq:1,accountId:'SYN-CAD-TAX',type:'buy',securityId:'SYN-EQUITY-1',currency:'CAD',quantity:'10',unitPrice:'100',fee:'0'},
    {id:'SYN-J6',date:'2026-02-03',seq:1,accountId:'SYN-CAD-TFSA',type:'buy',securityId:'SYN-ETF-1',currency:'CAD',quantity:'10',unitPrice:'150',fee:'0'},
    {id:'SYN-J7',date:'2026-02-04',seq:1,accountId:'SYN-CAD-TFSA',type:'buy',securityId:'SYN-CDR-1',currency:'CAD',quantity:'5',unitPrice:'50',fee:'0'},
    {id:'SYN-J8',date:'2026-02-05',seq:1,accountId:'SYN-USD-TEST',type:'buy',securityId:'SYN-USD-1',currency:'USD',quantity:'8',unitPrice:'200',fee:'0'},
    {id:'SYN-J9',date:'2026-03-01',seq:1,accountId:'SYN-CAD-TAX',type:'dividend',securityId:'SYN-ETF-1',currency:'CAD',amount:'40'},
    {id:'SYN-J10',date:'2026-03-02',seq:1,accountId:'SYN-USD-TEST',type:'dividend',securityId:'SYN-USD-1',currency:'USD',amount:'16'}
  ],
  quotes:[
    {securityId:'SYN-ETF-1',currency:'CAD',unitPrice:'160',asOf:'2026-11-01'},
    {securityId:'SYN-ETF-TECH',currency:'CAD',unitPrice:'160',asOf:'2026-11-01'},
    {securityId:'SYN-EQUITY-1',currency:'CAD',unitPrice:'105',asOf:'2026-11-01'},
    {securityId:'SYN-CDR-1',currency:'CAD',unitPrice:'52',asOf:'2026-11-01'},
    {securityId:'SYN-USD-1',currency:'USD',unitPrice:'210',asOf:'2026-11-01'}
  ],
  // Invented owner-policy example. Not a recommended allocation or market benchmark.
  exampleSectorPolicy:{synthetic:true,asOf:'2026-11-01',name:'Illustrative target mix',
    targets:[
      {key:'technology',weight:'25'},
      {key:'healthcare',weight:'20'},
      {key:'financials',weight:'20'},
      {key:'industrials',weight:'12'},
      {key:'consumer',weight:'10'},
      {key:'other',weight:'13'}
    ]},
  valuationFx:{from:'USD',to:'CAD',rate:'1.35',asOf:'2026-11-01',source:'Fictional fixed FX snapshot'}
});
export function getHoldingsFixture(){
  return structuredClone(holdingsFixture);
}
