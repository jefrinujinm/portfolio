import http from 'http';

// Helper to make GET/POST request
const makeRequest = (path, method = 'GET', body = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

async function runTests() {
  console.log('--- STARTING TRUSTCHAIN API VERIFICATION TESTS ---');

  try {
    // 1. Test Clean Product Verification
    console.log('\nTesting Product A (Clean): "clean-amox-908"');
    const verifyClean = await makeRequest('/api/products/clean-amox-908/verify', 'POST', {
      scanLocation: 'New York, NY',
      scannerWallet: '0xCustomerPublicScan'
    });
    console.log('Status Code:', verifyClean.status);
    console.log('isValid:', verifyClean.data.isValid);
    console.log('Message:', verifyClean.data.message);
    if (verifyClean.data.isValid === true) {
      console.log('✅ TEST PASSED: Clean product verified successfully.');
    } else {
      console.log('❌ TEST FAILED: Clean product verification failed.', verifyClean.data);
    }

    // 2. Test Tampered Ledger Verification
    console.log('\nTesting Product B (Tampered DB Ledger): "tampered-apples-402"');
    const verifyTampered = await makeRequest('/api/products/tampered-apples-402/verify', 'POST', {
      scanLocation: 'Seattle, WA',
      scannerWallet: '0xCustomerPublicScan'
    });
    console.log('Status Code:', verifyTampered.status);
    console.log('isValid:', verifyTampered.data.isValid);
    console.log('Reason:', verifyTampered.data.reason);
    console.log('Message:', verifyTampered.data.message);
    if (verifyTampered.data.isValid === false && verifyTampered.data.reason === 'CHAIN_BROKEN') {
      console.log('✅ TEST PASSED: Broken chain correctly detected.');
    } else {
      console.log('❌ TEST FAILED: Broken chain was not caught.', verifyTampered.data);
    }

    // 3. Test Counterfeit Duplicate Scan Verification
    console.log('\nTesting Product C (Counterfeit Clone Scan): "counterfeit-chip-777"');
    // Seeded product was sold in New York. We scan it from Miami.
    const verifyCounterfeit = await makeRequest('/api/products/counterfeit-chip-777/verify', 'POST', {
      scanLocation: 'Miami, FL',
      scannerWallet: '0xCustomerPublicScan'
    });
    console.log('Status Code:', verifyCounterfeit.status);
    console.log('isValid:', verifyCounterfeit.data.isValid);
    console.log('Reason:', verifyCounterfeit.data.reason);
    console.log('Message:', verifyCounterfeit.data.message);
    if (verifyCounterfeit.data.isValid === false && verifyCounterfeit.data.reason === 'SOLD_AND_SCANNED') {
      console.log('✅ TEST PASSED: Counterfeit clone scan flagged successfully.');
    } else {
      console.log('❌ TEST FAILED: Counterfeit scan not flagged.', verifyCounterfeit.data);
    }

    // 4. Test Handoff Validation on Sold Product
    console.log('\nTesting illegal handoff post-sale on "clean-amox-908"');
    const transferRes = await makeRequest('/api/products/clean-amox-908/transfer', 'POST', {
      actor: 'Distributor (BadActor)',
      actorWalletAddress: '0xBadActor99999999999999999999999999999999',
      location: 'Miami, FL',
      action: 'Distributor received product'
    });
    console.log('Status Code:', transferRes.status);
    console.log('counterfeit Flag:', transferRes.data.counterfeit);
    console.log('Error Type:', transferRes.data.error);
    console.log('Message:', transferRes.data.message);
    if (transferRes.status === 400 && transferRes.data.counterfeit === true && transferRes.data.error === 'TRANSFER_REJECTED_SOLD') {
      console.log('✅ TEST PASSED: Illegal handoff rejected and flagged as counterfeit.');
    } else {
      console.log('❌ TEST FAILED: Handoff was not rejected.', transferRes.data);
    }

    console.log('\n--- ALL VERIFICATION TESTS COMPLETED ---');
  } catch (err) {
    console.error('Testing encountered error:', err.message);
  }
}

runTests();
