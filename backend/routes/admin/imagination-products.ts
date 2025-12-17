
import { Router, Request, Response } from 'express';
import { imaginationProducts } from '../../services/imagination-products';

const router = Router();

// Get all imagination products
router.get('/', async (req: Request, res: Response) => {
    try {
        const products = await imaginationProducts.getAllProducts();
        res.json(products);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Initialize/Reset from config (DB Seed)
router.post('/init', async (req: Request, res: Response) => {
    try {
        await imaginationProducts.seedFromConfig();
        const products = await imaginationProducts.getAllProducts();
        res.json({ success: true, products });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Update product configuration
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        await imaginationProducts.updateProduct(id, updates);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Upsert size
router.post('/size', async (req: Request, res: Response) => {
    try {
        const sizeData = req.body;
        await imaginationProducts.upsertSize(sizeData);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete size
router.delete('/size', async (req: Request, res: Response) => {
    try {
        const { productId, height } = req.body;

        if (!productId || height === undefined) {
            res.status(400).json({ error: 'Missing productId or height' });
            return;
        }

        await imaginationProducts.deleteSize(productId, height);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
