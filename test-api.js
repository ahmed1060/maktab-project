async function main() {
    try {
        const res = await fetch('http://localhost:3000/api/companies');
        if (!res.ok) {
            console.log('Status:', res.status, res.statusText);
            const text = await res.text();
            console.log('Body:', text);
        } else {
            const json = await res.json();
            console.log('Companies:', JSON.stringify(json, null, 2));
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
}
main();
