// No user holdings; invented CAD/USD values and names only.
const household='SYN-HOUSEHOLD-A';
export const taxablePoolingFixture={
  synthetic:true,
  accounts:[
    {id:'SYN-TAX-A',ownerId:'SYN-OWNER-A',affiliationGroupId:household,type:'taxable'},
    {id:'SYN-TAX-B',ownerId:'SYN-OWNER-A',affiliationGroupId:household,type:'taxable'},
    {id:'SYN-TFSA-A',ownerId:'SYN-OWNER-A',affiliationGroupId:household,type:'tfsa'},
    {id:'SYN-OTHER-OWNER',ownerId:'SYN-OWNER-B',affiliationGroupId:'SYN-HOUSEHOLD-B',type:'taxable'}
  ],
  securities:[
    {id:'SYN-SHARE-ONE',identicalPropertyId:'SYN-PROP-ONE',currency:'CAD',kind:'equity'},
    {id:'SYN-SHARE-ALIAS',identicalPropertyId:'SYN-PROP-ONE',currency:'CAD',kind:'equity'}
  ],
  events:[
    {id:'SYN-E1',date:'2026-01-02',seq:1,type:'buy',accountId:'SYN-TAX-A',securityId:'SYN-SHARE-ONE',currency:'CAD',quantity:'10',unitPrice:'20'},
    {id:'SYN-E2',date:'2026-01-03',seq:1,type:'buy',accountId:'SYN-TAX-B',securityId:'SYN-SHARE-ALIAS',currency:'CAD',quantity:'10',unitPrice:'40'},
    {id:'SYN-E3',date:'2026-01-04',seq:1,type:'buy',accountId:'SYN-TFSA-A',securityId:'SYN-SHARE-ONE',currency:'CAD',quantity:'5',unitPrice:'100'},
    {id:'SYN-E4',date:'2026-01-05',seq:1,type:'buy',accountId:'SYN-OTHER-OWNER',securityId:'SYN-SHARE-ONE',currency:'CAD',quantity:'10',unitPrice:'10'},
    {id:'SYN-E5',date:'2026-02-01',seq:1,type:'sell',accountId:'SYN-TAX-A',securityId:'SYN-SHARE-ONE',currency:'CAD',quantity:'5',unitPrice:'30'}
  ]
};
export const foreignCurrencyFixture={
  synthetic:true,
  accounts:[{id:'SYN-TAX-FX',ownerId:'SYN-OWNER-X',affiliationGroupId:'SYN-GROUP-X',type:'taxable'}],
  securities:[{id:'SYN-USD-SEC',identicalPropertyId:'SYN-USD-PROP',currency:'USD',kind:'equity'}],
  events:[
    {id:'SYN-U1',date:'2026-01-02',seq:1,type:'buy',accountId:'SYN-TAX-FX',securityId:'SYN-USD-SEC',currency:'USD',quantity:'2',unitPrice:'100',fee:'2',fxToCad:'1.30'},
    {id:'SYN-U2',date:'2026-02-20',seq:1,type:'sell',accountId:'SYN-TAX-FX',securityId:'SYN-USD-SEC',currency:'USD',quantity:'1',unitPrice:'120',fee:'1',fxToCad:'1.35'}
  ]
};
export const affiliatedLossFixture={
  synthetic:true,
  accounts:[
    {id:'SYN-TAX-LOSS',ownerId:'SYN-OWNER-L',affiliationGroupId:'SYN-FAMILY-L',type:'taxable'},
    {id:'SYN-TFSA-LOSS',ownerId:'SYN-OWNER-L',affiliationGroupId:'SYN-FAMILY-L',type:'tfsa'},
    {id:'SYN-SPOUSE-LOSS',ownerId:'SYN-OWNER-S',affiliationGroupId:'SYN-FAMILY-L',type:'taxable'}
  ],
  securities:[{id:'SYN-LOSS-SEC',identicalPropertyId:'SYN-LOSS-PROP',currency:'CAD',kind:'equity'}],
  events:[
    {id:'SYN-L1',date:'2026-03-01',seq:1,type:'buy',accountId:'SYN-TAX-LOSS',securityId:'SYN-LOSS-SEC',currency:'CAD',quantity:'10',unitPrice:'30'},
    {id:'SYN-L2',date:'2026-03-10',seq:1,type:'sell',accountId:'SYN-TAX-LOSS',securityId:'SYN-LOSS-SEC',currency:'CAD',quantity:'5',unitPrice:'20'},
    {id:'SYN-L3',date:'2026-03-11',seq:1,type:'buy',accountId:'SYN-TFSA-LOSS',securityId:'SYN-LOSS-SEC',currency:'CAD',quantity:'5',unitPrice:'20'},
    {id:'SYN-L4',date:'2026-03-15',seq:1,type:'buy',accountId:'SYN-SPOUSE-LOSS',securityId:'SYN-LOSS-SEC',currency:'CAD',quantity:'1',unitPrice:'20'}
  ]
};
