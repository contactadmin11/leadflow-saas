/**
 * GST Calculation Service
 * Preserved exactly from original LeadFlow business logic.
 * 
 * Rules:
 * - If seller state === buyer state: CGST + SGST (each = gstRate/2)
 * - If seller state !== buyer state: IGST (= full gstRate)
 * - If either state is empty: CGST + SGST (default)
 */

const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands',
  'Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
  'Ladakh','Lakshadweep','Puducherry'
];

const GST_STATE_CODES = {
  '01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
  '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
  '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
  '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
  '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
  '24':'Gujarat','26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra',
  '28':'Andhra Pradesh','29':'Karnataka','30':'Goa','31':'Lakshadweep',
  '32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman and Nicobar Islands',
  '36':'Telangana','37':'Andhra Pradesh (new)','38':'Ladakh'
};

/**
 * Determine if transaction is inter-state (IGST) or intra-state (CGST+SGST)
 */
const isIGST = (sellerState, buyerState) => {
  if (!sellerState || !buyerState) return false;
  return sellerState.trim().toLowerCase() !== buyerState.trim().toLowerCase();
};

/**
 * Get state name from GSTIN prefix (first 2 digits)
 */
const stateFromGSTIN = (gstin) => {
  if (!gstin || gstin.length < 2) return '';
  const code = gstin.substring(0, 2);
  return GST_STATE_CODES[code] || '';
};

/**
 * Validate GSTIN format
 */
const validateGSTIN = (gstin) => {
  const pattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return pattern.test(gstin?.toUpperCase() || '');
};

/**
 * Calculate totals for a list of line items.
 * @param {Array} items - Array of { qty, rate, gstRate }
 * @param {string} sellerState - Seller's registered GST state
 * @param {string} buyerState  - Buyer's state
 * @param {boolean} gstEnabled - Whether GST is enabled for this business
 * @returns {object} { items (enriched), subtotal, cgst, sgst, igst, total, isIGST }
 */
const calculateTotals = (items, sellerState, buyerState, gstEnabled = true) => {
  const igst = gstEnabled && isIGST(sellerState, buyerState);

  const enriched = items.map(item => {
    const qty       = parseFloat(item.qty)     || 0;
    const rate      = parseFloat(item.rate)    || 0;
    const gstRate   = gstEnabled ? (parseFloat(item.gstRate) || 0) : 0;
    const amount    = Math.round(qty * rate * 100) / 100;
    const gstAmount = Math.round(amount * gstRate / 100 * 100) / 100;
    const total     = Math.round((amount + gstAmount) * 100) / 100;
    return { ...item, qty, rate, gstRate, amount, gstAmount, total };
  });

  const subtotal    = Math.round(enriched.reduce((s, i) => s + i.amount, 0)    * 100) / 100;
  const totalGST    = Math.round(enriched.reduce((s, i) => s + i.gstAmount, 0) * 100) / 100;

  const cgstAmt = igst ? 0 : Math.round(totalGST / 2 * 100) / 100;
  const sgstAmt = igst ? 0 : Math.round(totalGST / 2 * 100) / 100;
  const igstAmt = igst ? totalGST : 0;

  const total = Math.round((subtotal + totalGST) * 100) / 100;

  return {
    items: enriched,
    subtotal,
    cgst: cgstAmt,
    sgst: sgstAmt,
    igst: igstAmt,
    total,
    isIGSTTransaction: igst
  };
};

module.exports = { calculateTotals, isIGST, stateFromGSTIN, validateGSTIN, STATES, GST_STATE_CODES };
