const bcrypt = require('bcryptjs');

async function test() {
    const storedHash = '$2a$10$Pl3ALYG/.AY8pm/cTGzkCjdCSVfRvhxJiiBkGcfO';
    const passwords = ['admin123', 'Admin123', '123456'];

    console.log('Testing stored hash against different passwords:\n');

    for (const pwd of passwords) {
        const result = await bcrypt.compare(pwd, storedHash);
        console.log(`Password "${pwd}": ${result ? '✓ MATCH' : '✗ no match'}`);
    }

    console.log('\n--- Creating fresh hash for "admin123" ---');
    const freshHash = await bcrypt.hash('admin123', 10);
    console.log('Fresh hash:', freshHash);
    const testFresh = await bcrypt.compare('admin123', freshHash);
    console.log('Fresh hash works:', testFresh ? '✓ YES' : '✗ NO');
}

test();
