import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
import { sendWelcomeEmail } from '../utils/email.js';
import { handleConnectAccountUpdate, handlePayoutPaid, handlePayoutFailed } from '../services/stripe-connect.js';
const router = Router();
const prisma = new PrismaClient();
router.post('/brevo', async (req, res) => {
    try {
        const event = req.body;
        console.log('[Brevo Webhook] Received event:', event.event, 'for messageId:', event['message-id']);
        if (!event['message-id']) {
            console.warn('[Brevo Webhook] No message-id in event');
            return res.status(200).json({ received: true });
        }
        const messageId = event['message-id'];
        const eventTime = new Date(event.ts_event ? event.ts_event * 1000 : event.date);
        const { data: emailLog, error: findError } = await supabase
            .from('email_logs')
            .select('id, open_count, click_count, clicked_links')
            .eq('message_id', messageId)
            .single();
        if (findError || !emailLog) {
            console.warn('[Brevo Webhook] Email log not found for messageId:', messageId);
            return res.status(200).json({ received: true });
        }
        const update = {};
        switch (event.event) {
            case 'delivered':
                update.status = 'delivered';
                break;
            case 'opened':
                update.open_count = (emailLog.open_count || 0) + 1;
                if (!emailLog.open_count || emailLog.open_count === 0) {
                    update.opened_at = eventTime.toISOString();
                }
                break;
            case 'click':
                update.click_count = (emailLog.click_count || 0) + 1;
                if (!emailLog.click_count || emailLog.click_count === 0) {
                    update.clicked_at = eventTime.toISOString();
                }
                const currentLinks = emailLog.clicked_links || [];
                if (event.link) {
                    currentLinks.push({
                        url: event.link,
                        clicked_at: eventTime.toISOString()
                    });
                    update.clicked_links = currentLinks;
                }
                break;
            case 'hard_bounce':
            case 'soft_bounce':
                update.status = 'bounced';
                update.bounced_at = eventTime.toISOString();
                update.error_message = `${event.event}: Email could not be delivered`;
                break;
            case 'spam':
                update.status = 'spam';
                update.spam_reported_at = eventTime.toISOString();
                break;
            case 'unsubscribe':
                update.unsubscribed_at = eventTime.toISOString();
                break;
            case 'blocked':
            case 'invalid':
                update.status = 'failed';
                update.error_message = `${event.event}: Email blocked or invalid`;
                break;
            default:
                console.log('[Brevo Webhook] Unhandled event type:', event.event);
        }
        if (Object.keys(update).length > 0) {
            const { error: updateError } = await supabase
                .from('email_logs')
                .update(update)
                .eq('id', emailLog.id);
            if (updateError) {
                console.error('[Brevo Webhook] Failed to update email log:', updateError);
            }
            else {
                console.log('[Brevo Webhook] Updated email log:', emailLog.id, 'with:', Object.keys(update));
            }
        }
        return res.status(200).json({ received: true });
    }
    catch (error) {
        console.error('[Brevo Webhook] Processing error:', error);
        return res.status(200).json({ received: true, error: error.message });
    }
});
router.post('/supabase-auth', async (req, res) => {
    try {
        const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;
        if (webhookSecret) {
            const receivedSecret = req.headers['x-webhook-secret'];
            if (receivedSecret !== webhookSecret) {
                console.warn('[Supabase Webhook] Invalid webhook secret');
                return res.status(401).json({ error: 'Invalid webhook secret' });
            }
        }
        const payload = req.body;
        console.log('[Supabase Webhook] Received:', payload.type, 'on', payload.table);
        if (payload.type === 'INSERT' && payload.table === 'users') {
            const user = payload.record;
            const email = user.email;
            const metadata = user.raw_user_meta_data || {};
            const username = metadata.username || metadata.display_name || metadata.first_name || email?.split('@')[0] || 'Friend';
            if (email) {
                console.log('[Supabase Webhook] New user signup:', email, 'username:', username);
                try {
                    await sendWelcomeEmail(email, username);
                    console.log('[Supabase Webhook] ✅ Welcome email sent to:', email);
                }
                catch (emailError) {
                    console.error('[Supabase Webhook] ❌ Failed to send welcome email:', emailError);
                }
            }
            else {
                console.warn('[Supabase Webhook] New user has no email:', user.id);
            }
        }
        return res.status(200).json({ received: true });
    }
    catch (error) {
        console.error('[Supabase Webhook] Processing error:', error);
        return res.status(200).json({ received: true, error: error.message });
    }
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia'
});
router.post('/stripe', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error('Missing STRIPE_WEBHOOK_SECRET');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    let event;
    try {
        const body = JSON.stringify(req.body);
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    }
    catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
    }
    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                await handlePaymentSuccess(event.data.object);
                break;
            case 'payment_intent.payment_failed':
                await handlePaymentFailure(event.data.object);
                break;
            case 'account.updated': {
                const account = event.data.object;
                console.log('[Stripe Connect Webhook] Account updated:', account.id);
                await handleConnectAccountUpdate(account);
                break;
            }
            case 'payout.paid': {
                const payout = event.data.object;
                if (event.account) {
                    console.log('[Stripe Connect Webhook] Payout paid:', payout.id, 'account:', event.account);
                    await handlePayoutPaid(payout, event.account);
                }
                break;
            }
            case 'payout.failed': {
                const payout = event.data.object;
                if (event.account) {
                    console.log('[Stripe Connect Webhook] Payout failed:', payout.id, 'account:', event.account);
                    await handlePayoutFailed(payout, event.account);
                }
                break;
            }
            case 'invoice.paid': {
                const invoice = event.data.object;
                console.log('[Stripe Webhook] Invoice paid:', invoice.id);
                await handleInvoicePaid(invoice);
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                console.log('[Stripe Webhook] Invoice payment failed:', invoice.id);
                await handleInvoicePaymentFailed(invoice);
                break;
            }
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
        return res.status(200).json({ received: true });
    }
    catch (error) {
        console.error('Webhook processing error:', error);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
});
async function handlePaymentSuccess(paymentIntent) {
    try {
        const { metadata } = paymentIntent;
        console.log('[Stripe Webhook] Payment succeeded:', paymentIntent.id, 'metadata:', metadata);
        const orderId = metadata?.orderId;
        const paymentIntentIdForLookup = paymentIntent.id;
        let existingOrder = null;
        if (orderId) {
            const { data } = await supabase
                .from('orders')
                .select('id')
                .eq('id', orderId)
                .single();
            existingOrder = data;
        }
        if (!existingOrder) {
            const { data } = await supabase
                .from('orders')
                .select('id')
                .eq('stripe_payment_intent_id', paymentIntentIdForLookup)
                .single();
            existingOrder = data;
        }
        if (existingOrder) {
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                payment_status: 'paid',
                status: 'processing',
                stripe_payment_intent_id: paymentIntentIdForLookup,
                updated_at: new Date().toISOString()
            })
                .eq('id', existingOrder.id);
            if (updateError) {
                console.error('[Stripe Webhook] Failed to update order:', updateError);
            }
            else {
                console.log('[Stripe Webhook] ✅ Order updated to paid:', existingOrder.id);
            }
        }
        else {
            const items = JSON.parse(metadata?.items || '[]');
            const shipping = JSON.parse(metadata?.shipping || '{}');
            const { data: newOrder, error: createError } = await supabase
                .from('orders')
                .insert({
                order_number: `ITP-${Date.now().toString(36).toUpperCase()}`,
                stripe_payment_intent_id: paymentIntent.id,
                user_id: metadata?.userId || null,
                customer_email: metadata?.customerEmail || shipping?.email || null,
                subtotal: paymentIntent.amount / 100,
                total: paymentIntent.amount / 100,
                currency: paymentIntent.currency.toUpperCase(),
                status: 'processing',
                payment_status: 'paid',
                shipping_address: shipping,
                metadata: { items, source: 'webhook_fallback' }
            })
                .select()
                .single();
            if (createError) {
                console.error('[Stripe Webhook] Failed to create order:', createError);
            }
            else {
                console.log('[Stripe Webhook] ✅ New order created:', newOrder?.id);
            }
        }
        if (metadata?.userId && metadata?.itcAmount) {
            const itcAmount = parseFloat(metadata.itcAmount);
            const usdAmount = paymentIntent.amount / 100;
            const { data: wallet } = await supabase
                .from('user_wallets')
                .select('itc_balance')
                .eq('user_id', metadata.userId)
                .single();
            const currentBalance = wallet?.itc_balance || 0;
            const newBalance = currentBalance + itcAmount;
            const { error: walletError } = await supabase
                .from('user_wallets')
                .upsert({
                user_id: metadata.userId,
                itc_balance: newBalance,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (walletError) {
                console.error('[Stripe Webhook] Failed to update wallet:', walletError);
            }
            else {
                console.log('[Stripe Webhook] ✅ Wallet updated, new ITC balance:', newBalance);
            }
            await supabase
                .from('itc_transactions')
                .insert({
                user_id: metadata.userId,
                type: 'purchase',
                amount: itcAmount,
                balance_after: newBalance,
                usd_value: usdAmount,
                reason: 'ITC token purchase',
                reference_id: paymentIntent.id
            });
        }
        console.log(`[Stripe Webhook] Payment processing complete: ${paymentIntent.id}`);
    }
    catch (error) {
        console.error('[Stripe Webhook] Payment success handling error:', error);
    }
}
async function handlePaymentFailure(paymentIntent) {
    try {
        console.log(`Payment failed: ${paymentIntent.id}`, paymentIntent.last_payment_error);
    }
    catch (error) {
        console.error('Payment failure handling error:', error);
    }
}
async function handleInvoicePaid(stripeInvoice) {
    try {
        const founderId = stripeInvoice.metadata?.founder_id;
        if (!founderId) {
            console.log('[Invoice Webhook] Not a founder invoice, skipping');
            return;
        }
        const { data: invoice, error: findError } = await supabase
            .from('founder_invoices')
            .select('*')
            .eq('stripe_invoice_id', stripeInvoice.id)
            .single();
        if (findError || !invoice) {
            console.error('[Invoice Webhook] Invoice not found:', stripeInvoice.id);
            return;
        }
        const { error: updateError } = await supabase
            .from('founder_invoices')
            .update({
            status: 'paid',
            paid_at: new Date().toISOString()
        })
            .eq('id', invoice.id);
        if (updateError) {
            console.error('[Invoice Webhook] Failed to update invoice:', updateError);
            return;
        }
        const founderEarningsCents = invoice.founder_earnings_cents;
        const founderEarningsUSD = founderEarningsCents / 100;
        const { data: wallet, error: walletError } = await supabase
            .from('user_wallets')
            .select('itc_balance')
            .eq('user_id', founderId)
            .single();
        if (walletError || !wallet) {
            console.error('[Invoice Webhook] Founder wallet not found:', founderId);
            return;
        }
        const itcEarnings = founderEarningsCents;
        const newBalance = parseFloat(wallet.itc_balance || '0') + itcEarnings;
        const { error: walletUpdateError } = await supabase
            .from('user_wallets')
            .update({
            itc_balance: newBalance,
            updated_at: new Date().toISOString()
        })
            .eq('user_id', founderId);
        if (walletUpdateError) {
            console.error('[Invoice Webhook] Failed to update wallet:', walletUpdateError);
            return;
        }
        await supabase
            .from('itc_transactions')
            .insert({
            user_id: founderId,
            type: 'reward',
            amount: itcEarnings,
            balance_after: newBalance,
            usd_value: founderEarningsUSD,
            reason: `Invoice earnings (35% of $${(invoice.subtotal_cents / 100).toFixed(2)})`,
            reference_id: invoice.id
        });
        console.log(`[Invoice Webhook] ✅ Invoice paid: ${invoice.id}, Founder ${founderId} earned ${itcEarnings} ITC ($${founderEarningsUSD.toFixed(2)})`);
    }
    catch (error) {
        console.error('[Invoice Webhook] Invoice paid handling error:', error);
    }
}
async function handleInvoicePaymentFailed(stripeInvoice) {
    try {
        const founderId = stripeInvoice.metadata?.founder_id;
        if (!founderId) {
            console.log('[Invoice Webhook] Not a founder invoice, skipping');
            return;
        }
        const { error } = await supabase
            .from('founder_invoices')
            .update({ status: 'overdue' })
            .eq('stripe_invoice_id', stripeInvoice.id);
        if (error) {
            console.error('[Invoice Webhook] Failed to update invoice status:', error);
        }
        console.log(`[Invoice Webhook] Invoice payment failed: ${stripeInvoice.id}`);
    }
    catch (error) {
        console.error('[Invoice Webhook] Invoice payment failed handling error:', error);
    }
}
export default router;
//# sourceMappingURL=webhooks.js.map