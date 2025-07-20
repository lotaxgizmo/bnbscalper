// compound.js
const compound = (capital, ratePercent, times) => {
    const rate = ratePercent / 100;
    let amount = capital;

    for (let i = 1; i <= times; i++) {
      amount *= (1 + rate);
      console.log(`Count ${i}: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }

    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  // Set your values here
  const capital = 100;       // Starting capital in $
  const rate = 4.8;            // % increase per compounding
  const times = 18;         // Number of compounding steps
  
  const finalAmount = compound(capital, rate, times);
  console.log(`\n📈 Final amount after ${times} times: $${finalAmount}`);
