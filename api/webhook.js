const crypto = require('crypto');

// Configuración (añadir como variables de entorno en Vercel)
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOP_DOMAIN = process.env.SHOP_DOMAIN; // ejemplo: tu-tienda.myshopify.com

// Verificar webhook de Shopify
function verifyWebhook(rawBody, signature) {
  const hmac = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET);
  hmac.update(rawBody, 'utf8');
  const computedSignature = hmac.digest('base64');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}

// Obtener número total de pedidos del cliente
async function getCustomerOrderCount(customerId) {
  try {
    const response = await fetch(
      `https://${SHOP_DOMAIN}/admin/api/2023-10/customers/${customerId}/orders/count.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const data = await response.json();
    return data.count || 0;
  } catch (error) {
    console.error('Error getting customer order count:', error);
    return 0;
  }
}

// Crear tarjeta regalo
async function createGiftCard(customerId, amount, customerEmail) {
  try {
    const giftCardData = {
      gift_card: {
        initial_value: parseFloat(amount).toFixed(2),
        customer_id: customerId,
        note: `Tarjeta regalo automática - 10% del segundo pedido`
      }
    };

    const response = await fetch(
      `https://${SHOP_DOMAIN}/admin/api/2023-10/gift_cards.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(giftCardData)
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log(`Tarjeta regalo creada: $${amount} para cliente ${customerEmail}`);
    return result.gift_card;

  } catch (error) {
    console.error('Error creating gift card:', error);
    throw error;
  }
}

// Enviar email de notificación al cliente (opcional)
async function sendGiftCardNotification(customerEmail, giftCardCode, amount) {
  // Aquí puedes integrar con un servicio de email gratuito como:
  // - EmailJS
  // - Resend (tiene plan gratuito)
  // - O simplemente loggear para envío manual
  
  console.log(`
    NOTIFICACIÓN PENDIENTE:
    Email: ${customerEmail}
    Código: ${giftCardCode}
    Monto: $${amount}
  `);
}

// Función principal del webhook
export default async function handler(req, res) {
  // Solo acepta POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verificar webhook signature
    const signature = req.headers['x-shopify-hmac-sha256'];
    const rawBody = JSON.stringify(req.body);
    
    if (!verifyWebhook(rawBody, signature)) {
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    const order = req.body;
    
    // Verificar que el pedido tiene cliente
    if (!order.customer || !order.customer.id) {
      console.log('Pedido sin cliente asociado, ignorando...');
      return res.status(200).json({ message: 'No customer associated' });
    }

    // Obtener número total de pedidos del cliente
    const customerOrderCount = await getCustomerOrderCount(order.customer.id);
    
    console.log(`Cliente ${order.customer.email} tiene ${customerOrderCount} pedidos`);

    // Si es exactamente el segundo pedido, crear tarjeta regalo
    if (customerOrderCount === 2) {
      const orderTotal = parseFloat(order.total_price);
      const giftCardAmount = (orderTotal * 0.10).toFixed(2);
      
      console.log(`Procesando segundo pedido para ${order.customer.email}`);
      console.log(`Monto del pedido: $${orderTotal}`);
      console.log(`Tarjeta regalo: $${giftCardAmount}`);

      // Crear la tarjeta regalo
      const giftCard = await createGiftCard(
        order.customer.id,
        giftCardAmount,
        order.customer.email
      );

      // Opcional: Enviar notificación
      if (giftCard && giftCard.code) {
        await sendGiftCardNotification(
          order.customer.email,
          giftCard.code,
          giftCardAmount
        );
      }

      return res.status(200).json({
        message: 'Gift card created successfully',
        amount: giftCardAmount,
        customer: order.customer.email
      });
    }

    // Si no es el segundo pedido, solo confirmar recepción
    return res.status(200).json({
      message: 'Webhook processed, no action needed',
      orderCount: customerOrderCount
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
