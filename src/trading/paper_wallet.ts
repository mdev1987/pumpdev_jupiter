export class PaperWallet {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  getBalance() {
    return this.balance;
  }

  deposit(v: number) {
    this.balance += v;
  }

  withdraw(v: number) {
    if (v > this.balance) throw Error("Insufficient SOL");
    this.balance -= v;
  }
}
