import { sum } from './candidate.mjs';
const values = Array.from({ length: 10_000 }, (_, index) => index % 201 - 100);
let checksum = 0;
for (let iteration = 0; iteration < 200; iteration++) checksum += sum(values);
console.log(JSON.stringify({ workload: 'vector-sum-v1', iterations: 200, length: values.length, checksum }));
