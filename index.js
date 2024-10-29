const axios = require('axios');
const { google } = require('googleapis');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Initialize the Secret Manager client
const client = new SecretManagerServiceClient();

// Google Sheets API setup
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

async function fetchInvoiceDetails(invoiceId, accessToken, organizationId) {
    try {
        const response = await axios.get(`https://www.zohoapis.com/invoices/${invoiceId}`, {
            params: { organization_id: organizationId },
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data.invoice;
    } catch (error) {
        console.error(`Error fetching invoice details for ID ${invoiceId}: ${error.message}`);
        return null;  // Return null if there's an error fetching details
    }
}

async function fetchAllInvoices(accessToken) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().slice(0, 10);

    const organizationId = process.env.ORGANIZATION_ID;
    try {
        const response = await axios.get('https://www.zohoapis.com/invoices', {
            params: { organization_id: organizationId, per_page: 200 },
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const invoices = response.data.invoices.filter(invoice => invoice.date.startsWith(yesterdayString));
        return Promise.all(invoices.map(invoice => fetchInvoiceDetails(invoice.invoice_id, accessToken, organizationId)));
    } catch (error) {
        console.error('Error fetching invoices:', error.response ? error.response.data : error.message);
        return [];
    }
}

async function appendDataToSheet(data) {
    if (!data.length) {
        console.log('No data to append, exiting.');
        return;
    }

    const resource = {
        values: data.map(invoice => [
            invoice.date, // Date in Y-M-D
            invoice.invoice_number, // Invoice Number
            invoice.customer_name, // Customer Name
            invoice.line_items.map(item => item.name).join(', '), // Line Items Names
            invoice.line_items.map(item => item.quantity).join(', '), // Line Items Quantities
            invoice.line_items.map(item => item.sku).join(', '), // SKUs
            invoice.total,  // Invoice Total
            invoice.invoice_id, // Invoice ID
            invoice.customer_id // Customer ID
        ]).filter(row => row[0])  // Ensure no undefined rows
    };

    try {
        const spreadsheetId = process.env.SHEET_ID;
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: 'All Orders',
            valueInputOption: 'USER_ENTERED',
            resource,
        });
        console.log('Data appended to Sheet:', response.data.updates);
    } catch (error) {
        console.error('Error appending data to Google Sheets:', error.message);
    }
}

async function accessSecret(secretName) {
    try {
        const [version] = await client.accessSecretVersion({
            name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`
        });
        return version.payload.data.toString('utf8');
    } catch (error) {
        console.error(`Failed to retrieve secret ${secretName}:`, error);
        throw new Error(`Failed to retrieve secret ${secretName}`);
    }
}

exports.processInvoices = async (req, res) => {
    try {
        const accessToken = await accessSecret('ACCESS_TOKEN');
        const detailedInvoices = await fetchAllInvoices(accessToken);
        if (detailedInvoices.length > 0) {
            await appendDataToSheet(detailedInvoices);
            res.status(200).send('Invoices processed successfully.');
        } else {
            res.status(404).send('No invoices found for yesterday.');
        }
    } catch (error) {
        console.error('Failed to process invoices:', error);
        res.status(500).send(`Error processing invoices: ${error.message}`);
    }
};